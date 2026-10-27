// One always-on-top window for each bubble, its saved state, its drag and its tray menu.
//
// A bubble window loads the normal app with `?window=bubble&server=local&agent=<id>`. The renderer
// runs it as a chat window (#2964) and shows the orb or the compact panel. The window has the
// sandboxed preload, the navigation guard and the deny-all open handler of a chat window, and no
// other privilege.

import { join } from "node:path";
import {
  BUBBLE_LIMITS,
  type BubbleAttachIssue,
  type BubbleBounds,
  type BubbleCharacterId,
  type BubbleDragPoint,
  type BubbleMotionCue,
  type BubbleState,
  type BubblesSnapshot,
  IPC_ENDPOINTS,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { BrowserWindow, globalShortcut, Menu, type NativeImage, screen, Tray } from "electron";
import { PreferenceStore } from "../preference-file";
import { sendToRenderer } from "../renderer-ipc";
import { isTrustedRendererUrl } from "../trusted-renderer";
import {
  clampOrb,
  defaultOrbPosition,
  dockStop,
  expandedBounds,
  orbSize,
  PANEL_OFFSET,
  separateOrb,
  workAreaFor,
} from "./bubble-layout";
import {
  BUMP_RESPONSE,
  bumpOffset,
  DEFAULT_RESPONSE,
  NUDGE_MIN_DISTANCE,
  nudgeTarget,
  type SpringState,
  springSettled,
  springStep,
  VISIT_RESPONSE,
  visitSpot,
} from "./bubble-motion";
import { BUBBLES_STATE_FILE, copyBubble, decodeBubblesFile, EMPTY_BUBBLES, newBubble } from "./bubble-state-file";
import { setBubbleWindowSource } from "./bubble-window-registry";
import { gazeToward, theaterSeats } from "./scenes";

const logger = createOpenBotLogger("bubbles");

export const BUBBLES_TOGGLE_SHORTCUT = "CommandOrControl+Shift+Space";
/** A pointer that moves less than this between down and up is a click, not a drag. */
export const BUBBLE_CLICK_SLOP = 4;
const LOCAL_SERVER_ID = "local";

export interface BubbleAgent {
  id: string;
  name: string;
}

/** What happens when a dragged orb is released. Phase 3 attaches it to the window under the pointer. */
/**
 * Drag-to-attach, as main's drag sees it. Attaching is deliberate: only a drag with Option (Alt) held
 * attaches. While it is held and the orb rests, `dwell` shows which window it would attach to.
 */
export interface BubbleAttachHandler {
  /** The pointer has rested over one place mid-drag. */
  dwell: (agentId: string, pointer: { x: number; y: number }) => void;
  /** The drag moved on after a dwell. */
  disarm: (agentId: string) => void;
  /**
   * The drag ended. `attach` is Option (Alt) held at release; without it the release is always a free
   * placement. True when the bubble attaches, which then snaps instead of gliding.
   */
  release: (agentId: string, attach: boolean, pointer: { x: number; y: number }) => boolean;
}

export interface BubbleWindowManagerOptions {
  userDataPath: string;
  appIconPath: string;
  translate: () => AppTranslate;
  isQuitting: () => boolean;
  /** The local agents now. A bubble for an agent that is not here is closed. */
  listAgents: () => BubbleAgent[];
  /** Shows the main window at the agent. */
  focusMainWindow: (agentId: string) => void;
  quit: () => void;
}

interface OpenBubble {
  window: BrowserWindow;
  /** Set while main moves the window itself, so its own `moved` event is not a user move. */
  settingBounds: boolean;
  dragging: boolean;
  /** The frame timer of a nudge in flight; the orb is away from its saved place while it runs. */
  nudge: ReturnType<typeof setInterval> | null;
  /** Fires when the pointer rests mid-drag. */
  dwellTimer: ReturnType<typeof setTimeout> | null;
  /** Where the orb was when it rested, so a small tremor does not disarm. */
  dwellAt: { x: number; y: number } | null;
  /** On a visit to other bubbles. */
  visiting: boolean;
  /** The frame timer of an open or close in flight. */
  morph: ReturnType<typeof setInterval> | null;
  /** Whether the window was last laid out expanded, so a change of it is animated. */
  shownExpanded: boolean;
  /** Following the agent's own Computer Use actions over its attached window. */
  working: boolean;
  /** In a seat at a show on the screen (`setScene`); the saved place is kept for after it. */
  seated?: boolean;
  lastVisitAt: number;
  /** Waiting beside the pointer to go home; a drag or a click there cancels the trip home. */
  homeTimer: ReturnType<typeof setTimeout> | null;
  lastNudgeAt: number;
}

/** How long the orb rests, with Option held, before it shows the window it would attach to. */
const DWELL_MS = 250;
/** How far the orb may drift and still count as resting. */
const DWELL_TOLERANCE = 24;
/** One nudge a minute at most for each orb: a nudge that repeats is noise. */
const NUDGE_INTERVAL_MS = 60_000;
/** A bubble visits at most this often; its renderer asks more often when more bubbles are out. */
const VISIT_INTERVAL_MS = 15_000;
/** The open and close spring: quick, with no overshoot, so the panel lands without a wobble. */
const MORPH_RESPONSE = 0.32;
/** How far from the agent's action point the orb hovers, so it never covers what is being done. */
const WORK_OFFSET = 18;
/** How long two bubbles stay together on a visit. */
const VISIT_HOLD_MS = 2_600;
/** How long the orb hovers over the app before it goes home. */
const NUDGE_HOLD_MS = 4_500;
/** How long the orb pauses at each stop of a trip to an app (by the Dock, as if to open the app). */
const JOURNEY_HOLD_MS = 360;
/** The audience files in one orb after another, not all at once. */
const SEAT_STAGGER_MS = 140;
/** The close of an open panel finishes before the orb leaves on a trip. */
const JOURNEY_AFTER_CLOSE_MS = 420;
/** The orb moves once per display frame: 8.3 ms on a 120 Hz display, never slower than 60 Hz. */
function frameInterval(point: { x: number; y: number }): number {
  const frequency = screen.getDisplayNearestPoint(point).displayFrequency;
  return 1000 / Math.max(60, Math.min(240, Number.isFinite(frequency) && frequency > 0 ? frequency : 60));
}

/** A bubble whose renderer dies is opened again, but not in a loop. */
const REOPEN_WINDOW_MS = 10_000;

export class BubbleWindowManager {
  readonly #options: BubbleWindowManagerOptions;
  readonly #store: PreferenceStore<BubblesSnapshot>;
  #state: BubblesSnapshot = { ...EMPTY_BUBBLES };
  readonly #open = new Map<string, OpenBubble>();
  #tray: Tray | null = null;
  #trayIcon: NativeImage | null = null;
  #shortcutRegistered = false;
  #attachHandler: BubbleAttachHandler | null = null;
  /** The app window in front, which a nudge hovers over; null without the Computer Use driver. */
  #frontWindow: () => Promise<BubbleBounds | null> = async () => null;
  #destroyed = false;
  readonly #lastReopen = new Map<string, number>();
  #displaysWatched = false;
  #unwatchDisplays: () => void = () => undefined;

  constructor(options: BubbleWindowManagerOptions) {
    this.#options = options;
    this.#store = new PreferenceStore<BubblesSnapshot>({
      path: join(options.userDataPath, BUBBLES_STATE_FILE),
      defaultValue: EMPTY_BUBBLES,
      decode: decodeBubblesFile,
    });
    setBubbleWindowSource(
      () => this.windows(),
      (agentId) => {
        if (!this.#find(agentId)) return false;
        this.setHidden(false);
        this.setExpanded(agentId, true);
        return true;
      },
    );
  }

  /** Reads the saved bubbles and opens each one whose agent still exists. */
  restore(): Effect.Effect<void> {
    this.#watchDisplays();
    return Effect.gen({ self: this }, function* () {
      yield* this.#store
        .load()
        .pipe(
          Effect.catch((error) =>
            Effect.sync(() => logger.warn("Could not read the saved bubbles:", toLogValue(error.cause))),
          ),
        );
      const agents = new Set(this.#options.listAgents().map((agent) => agent.id));
      const saved = this.#store.get();
      const workAreas = this.#workAreas();
      this.#state = {
        ...saved,
        bubbles: saved.bubbles
          .filter((bubble) => agents.has(bubble.agentId))
          .map((bubble) => ({ ...copyBubble(bubble), ...clampOrb(bubble, workAreas) })),
      };
      for (const bubble of this.#state.bubbles) this.#openWindow(bubble);
      this.#afterChange(saved.bubbles.length !== this.#state.bubbles.length);
    });
  }

  snapshot(): BubblesSnapshot {
    return {
      hidden: this.#state.hidden,
      bubbles: this.#state.bubbles.map(copyBubble),
      characters: this.#state.characters.map((choice) => ({ ...choice })),
      nudges: this.#state.nudges,
    };
  }

  bubble(agentId: string): BubbleState | null {
    const bubble = this.#state.bubbles.find((candidate) => candidate.agentId === agentId);
    return bubble ? copyBubble(bubble) : null;
  }

  windows(): BrowserWindow[] {
    return [...this.#open.values()].map((open) => open.window).filter((window) => !window.isDestroyed());
  }

  hasBubbles(): boolean {
    return this.#state.bubbles.length > 0;
  }

  /** The agent of a bubble window, from the id of the web contents that sent an IPC request. */
  agentForSender(senderId: number): string | null {
    for (const [agentId, open] of this.#open) {
      if (!open.window.isDestroyed() && open.window.webContents.id === senderId) return agentId;
    }
    return null;
  }

  setAttachHandler(handler: BubbleAttachHandler): void {
    this.#attachHandler = handler;
  }

  setFrontWindowSource(read: () => Promise<BubbleBounds | null>): void {
    this.#frontWindow = read;
  }

  /** Tells a dragged bubble which app it would attach to on release, or null. */
  sendAttachHint(agentId: string, app: string | null): void {
    sendToRenderer(this.#open.get(agentId)?.window, IPC_ENDPOINTS.bubbles.attachHint, { agentId, app });
  }

  open(agentId: string): void {
    if (!this.#options.listAgents().some((agent) => agent.id === agentId)) {
      throw new Error("The agent is not on this computer.");
    }
    const existing = this.#open.get(agentId);
    if (existing && !existing.window.isDestroyed()) {
      this.setHidden(false);
      existing.window.showInactive();
      return;
    }
    if (this.#state.bubbles.length >= BUBBLE_LIMITS.bubbles) throw new Error("Too many bubbles are open.");
    const bubble = newBubble(agentId, defaultOrbPosition(this.#state.bubbles, this.#workAreas()));
    this.#state = { ...this.#state, hidden: false, bubbles: [...this.#state.bubbles, bubble] };
    this.#openWindow(bubble);
    this.#afterChange(true);
  }

  close(agentId: string): void {
    const open = this.#open.get(agentId);
    this.#remove(agentId);
    if (open && !open.window.isDestroyed()) open.window.destroy();
  }

  setExpanded(agentId: string, expanded: boolean): void {
    // A nudging orb that is clicked opens at home: the panel always opens from the saved corner.
    this.#stopNudge(agentId);
    this.#update(agentId, (bubble) => ({ ...bubble, expanded }));
    const open = this.#open.get(agentId);
    if (expanded && open && !open.window.isDestroyed()) {
      open.window.show();
      open.window.focus();
    }
  }

  setHidden(hidden: boolean): void {
    if (this.#state.hidden === hidden) return;
    this.#state = { ...this.#state, hidden };
    for (const open of this.#open.values()) {
      if (open.window.isDestroyed()) continue;
      if (hidden) open.window.hide();
      else open.window.showInactive();
    }
    this.#afterChange(true);
  }

  toggleHidden(): void {
    this.setHidden(!this.#state.hidden);
  }

  focusMain(agentId: string): void {
    this.#options.focusMainWindow(agentId);
  }

  /** Tells one bubble why its last drop did not attach, or that it did (null). */
  reportAttachIssue(agentId: string, issue: BubbleAttachIssue | null): void {
    // The notice waits for the user to open the bubble; a drag never opens it.
    sendToRenderer(this.#open.get(agentId)?.window, IPC_ENDPOINTS.bubbles.attachStatus, { agentId, issue });
  }

  /** The driver's ids for the bubble windows, which a drop looks through. */
  driverWindowIds(): Set<number> {
    const ids = new Set<number>();
    for (const window of this.windows()) {
      const id = Number(window.getMediaSourceId().split(":")[1]);
      if (Number.isSafeInteger(id)) ids.add(id);
    }
    return ids;
  }

  setCharacter(agentId: string, character: BubbleCharacterId | null): void {
    const others = this.#state.characters.filter((choice) => choice.agentId !== agentId);
    if (!character && others.length === this.#state.characters.length) return;
    this.#state = { ...this.#state, characters: character ? [...others, { agentId, character }] : others };
    this.#afterChange(true);
  }

  setNudges(nudges: boolean): void {
    if (this.#state.nudges === nudges) return;
    this.#state = { ...this.#state, nudges };
    if (!nudges) for (const agentId of this.#open.keys()) this.#stopNudge(agentId);
    this.#afterChange(true);
  }

  /**
   * The orb travels to the pointer, waits there, and goes home. Only a collapsed, unattached,
   * visible orb nudges, at most once a minute, and only while nudges are on. The renderer asks
   * for it (a reply arrived, an answer is needed) and skips it under reduced motion.
   */
  nudge(agentId: string): void {
    const open = this.#open.get(agentId);
    const bubble = this.#find(agentId);
    if (!open || !bubble || open.window.isDestroyed() || open.dragging || open.nudge || open.homeTimer || open.visiting)
      return;
    if (!this.#state.nudges || this.#state.hidden || bubble.expanded || bubble.attached) return;
    const now = Date.now();
    if (now - open.lastNudgeAt < NUDGE_INTERVAL_MS) return;
    open.lastNudgeAt = now;
    void this.#frontWindow()
      .catch(() => null)
      .then((front) => {
        const current = this.#find(agentId);
        // The user may have grabbed or opened it while the window list was read.
        if (!current || current.expanded || open.dragging || open.window.isDestroyed()) return;
        const away = nudgeTarget(front, screen.getCursorScreenPoint(), this.#workAreas());
        if (Math.hypot(away.x - current.x, away.y - current.y) < NUDGE_MIN_DISTANCE) return;
        this.#hoverThenReturn(agentId, open, away);
      });
  }

  /** Flies to `away`, hovers there while the renderer bobs the character, and flies home. */
  #hoverThenReturn(agentId: string, open: OpenBubble, away: { x: number; y: number }): void {
    open.window.showInactive();
    this.#travel(agentId, away, () => {
      open.homeTimer = setTimeout(() => {
        open.homeTimer = null;
        const home = this.#find(agentId);
        if (home && !home.expanded) this.#travel(agentId, home, () => undefined);
      }, NUDGE_HOLD_MS);
    });
  }

  /**
   * Bubbles mingle: the orb floats over to one or two other orbs, they greet (each plays "greet") and
   * the one it reaches gives way with a small bump, then it floats home. More bubbles on screen means
   * more visits, because each one asks on its own timer. Only collapsed, unattached, idle orbs take
   * part, and only while lively bubbles (the nudge setting) are on; the renderer skips it under
   * reduced motion. The saved home never changes.
   */
  visit(agentId: string, caller: string | null = null): void {
    const open = this.#open.get(agentId);
    const bubble = this.#find(agentId);
    if (!open || !bubble || !this.#canWander(open, bubble)) return;
    const now = Date.now();
    // A call from another agent is answered at once; a social visit waits its turn.
    if (!caller && now - open.lastVisitAt < VISIT_INTERVAL_MS) return;
    const calling = caller && caller !== agentId && this.#open.has(caller) ? [caller] : null;
    if (caller && !calling) return;
    const partners =
      calling ??
      this.#state.bubbles
        .filter((other) => other.agentId !== agentId)
        .flatMap((other) => {
          const partner = this.#open.get(other.agentId);
          return partner && this.#canWander(partner, other) ? [other.agentId] : [];
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, Math.random() < 0.5 ? 2 : 1);
    if (partners.length === 0) return;
    open.lastVisitAt = now;
    open.visiting = true;
    open.window.showInactive();
    const goHome = () => {
      const home = this.#find(agentId);
      if (!home || home.expanded) {
        open.visiting = false;
        return;
      }
      this.#travel(agentId, home, () => (open.visiting = false), VISIT_RESPONSE);
    };
    const next = (index: number) => {
      const partnerId = partners[index];
      const partner = partnerId ? this.#open.get(partnerId) : undefined;
      if (!partnerId || !partner || partner.window.isDestroyed() || !open.visiting) {
        goHome();
        return;
      }
      const [px = 0, py = 0] = partner.window.getPosition();
      const [vx = 0, vy = 0] = open.window.getPosition();
      const spot = visitSpot({ x: vx, y: vy }, { x: px, y: py }, this.#workAreas(), Math.random() * 2 - 1);
      this.#travel(
        agentId,
        spot,
        () => {
          if (!open.visiting) return;
          this.#cue(agentId);
          this.#cue(partnerId);
          this.#bump(partnerId, spot);
          open.homeTimer = setTimeout(() => {
            open.homeTimer = null;
            next(index + 1);
          }, VISIT_HOLD_MS);
        },
        VISIT_RESPONSE,
      );
    };
    next(0);
  }

  /**
   * The orb plays around its agent's work: while the agent acts on the attached window, the orb
   * floats to just above where it acts; `null` sends it back to the window's corner. Not saved.
   */
  workAt(agentId: string, point: { x: number; y: number } | null): void {
    const open = this.#open.get(agentId);
    const bubble = this.#find(agentId);
    if (!open || !bubble || open.window.isDestroyed() || open.dragging || bubble.expanded || !bubble.attached) return;
    if (!point) {
      if (!open.working) return;
      this.#travel(agentId, bubble, () => (open.working = false));
      return;
    }
    open.working = true;
    const size = orbSize(bubble);
    const area = workAreaFor({ ...point, width: 1, height: 1 }, this.#workAreas());
    // The orb (at the right end of the attached window) sits just above and right of the action.
    const x = point.x + WORK_OFFSET - (size.width - BUBBLE_LIMITS.orbSize);
    const y = point.y - BUBBLE_LIMITS.orbSize - WORK_OFFSET;
    this.#travel(
      agentId,
      {
        x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - size.width)),
        y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - size.height)),
      },
      () => undefined,
    );
  }

  /** Where an orb stops by the Dock of the display a point is on; null when that Dock is hidden. */
  dockStopNear(point: { x: number; y: number }): { x: number; y: number } | null {
    return dockStop(screen.getDisplayNearestPoint(point));
  }

  /**
   * The orb goes to work: it flies through each stop in turn (by the Dock, then onto the window it was
   * sent to) and calls back when it arrives. An open panel closes first, so the user sees the orb
   * leave. A drag cuts the trip short where it is, and the caller's own timeout covers that. The saved
   * place is not touched here: attaching, which follows, sets it.
   */
  journey(agentId: string, stops: readonly { x: number; y: number }[], done: () => void): void {
    const open = this.#open.get(agentId);
    const bubble = this.#find(agentId);
    if (!open || !bubble || open.window.isDestroyed() || stops.length === 0) {
      done();
      return;
    }
    const wasExpanded = bubble.expanded;
    if (wasExpanded) this.setExpanded(agentId, false);
    else this.#stopNudge(agentId, false);
    open.visiting = true;
    open.window.showInactive();
    const next = (index: number) => {
      const stop = stops[index];
      if (!stop || !open.visiting || open.window.isDestroyed()) {
        open.visiting = false;
        done();
        return;
      }
      this.#travel(
        agentId,
        stop,
        () => {
          if (index + 1 >= stops.length) {
            open.visiting = false;
            done();
            return;
          }
          open.homeTimer = setTimeout(() => {
            open.homeTimer = null;
            next(index + 1);
          }, JOURNEY_HOLD_MS);
        },
        VISIT_RESPONSE,
      );
    };
    open.homeTimer = setTimeout(
      () => {
        open.homeTimer = null;
        next(0);
      },
      wasExpanded ? JOURNEY_AFTER_CLOSE_MS : 0,
    );
  }

  /** Free to wander: shown, collapsed, unattached, not held, not already on a trip. */
  #canWander(open: OpenBubble, bubble: BubbleState): boolean {
    return (
      !open.window.isDestroyed() &&
      this.#state.nudges &&
      !this.#state.hidden &&
      !bubble.expanded &&
      !bubble.attached &&
      !open.dragging &&
      !open.visiting &&
      !open.seated &&
      !open.nudge &&
      !open.homeTimer
    );
  }

  /** The visited orb is pushed a little away from the visitor and springs back home. */
  #bump(agentId: string, from: { x: number; y: number }): void {
    const open = this.#open.get(agentId);
    const bubble = this.#find(agentId);
    if (!open || !bubble || open.window.isDestroyed() || open.dragging || open.nudge || bubble.expanded) return;
    const push = bumpOffset(from, bubble);
    this.#travel(
      agentId,
      { x: bubble.x + push.x, y: bubble.y + push.y },
      () => {
        const home = this.#find(agentId);
        if (home && !home.expanded && !open.dragging) this.#travel(agentId, home, () => undefined);
      },
      BUMP_RESPONSE,
    );
  }

  #cue(agentId: string): void {
    this.#cueMotion(agentId, { agentId, cue: "greet" });
  }

  #cueMotion(agentId: string, cue: BubbleMotionCue): void {
    sendToRenderer(this.#open.get(agentId)?.window, IPC_ENDPOINTS.bubbles.motionCue, cue);
  }

  /** Whether a show could seat anyone: lively bubbles on, not hidden, and a free collapsed orb out. */
  canStage(): boolean {
    return (
      this.#state.nudges &&
      !this.#state.hidden &&
      this.#state.bubbles.some((bubble) => !bubble.expanded && !bubble.attached && this.#open.has(bubble.agentId))
    );
  }

  /** The displays' full bounds, for telling a full-screen window. */
  displayBounds(): BubbleBounds[] {
    return screen.getAllDisplays().map((display) => display.bounds);
  }

  /**
   * A show on the screen: every idle orb takes a seat in a row along the stage, one after another,
   * and looks at it; an orb already in its seat only gets the new gaze. Null ends the show: the
   * seated orbs look at the user again and float home. A click or a drag on a seated orb ends its
   * seat by itself (`#stopNudge`). The saved places never change.
   */
  setScene(scene: { stage: BubbleBounds } | null): void {
    if (!scene) {
      for (const [agentId, open] of this.#open) if (open.seated) this.#unseat(agentId, open);
      return;
    }
    const audience = this.#state.bubbles.filter((bubble) => {
      const open = this.#open.get(bubble.agentId);
      return open !== undefined && (open.seated === true || this.#canWander(open, bubble));
    });
    if (audience.length === 0) return;
    const seats = theaterSeats(scene.stage, audience.length, workAreaFor(scene.stage, this.#workAreas()));
    audience.forEach((bubble, index) => {
      const open = this.#open.get(bubble.agentId);
      const seat = seats[index];
      if (!open || !seat || open.window.isDestroyed()) return;
      const gaze = gazeToward(seat, scene.stage);
      const [x = 0, y = 0] = open.window.getPosition();
      if (open.seated && Math.abs(x - seat.x) < 2 && Math.abs(y - seat.y) < 2) {
        this.#cueMotion(bubble.agentId, { agentId: bubble.agentId, cue: "watch", gaze });
        return;
      }
      open.seated = true;
      open.visiting = true;
      open.window.showInactive();
      setTimeout(() => {
        if (!open.seated || open.window.isDestroyed()) return;
        this.#travel(
          bubble.agentId,
          seat,
          () => {
            if (open.seated) this.#cueMotion(bubble.agentId, { agentId: bubble.agentId, cue: "watch", gaze });
          },
          VISIT_RESPONSE,
        );
      }, index * SEAT_STAGGER_MS);
    });
  }

  #unseat(agentId: string, open: OpenBubble): void {
    open.seated = false;
    open.visiting = false;
    this.#cueMotion(agentId, { agentId, cue: "rest" });
    const home = this.#find(agentId);
    if (home && !home.expanded && !open.window.isDestroyed())
      this.#travel(agentId, home, () => undefined, VISIT_RESPONSE);
  }

  /**
   * The point a drop is judged by: the centre of the orb, which is under the pointer during a drag.
   * An attached orb's window is wider, with the orb at its right end.
   */
  #orbCentre(agentId: string, corner: { x: number; y: number }): { x: number; y: number } {
    const size = orbSize(this.#find(agentId) ?? { attached: null });
    const half = BUBBLE_LIMITS.orbSize / 2;
    return { x: Math.round(corner.x + size.width - half), y: Math.round(corner.y + half) };
  }

  /** Moves a collapsed orb to `to` on the spring, frame by frame, without saving the position. */
  #travel(agentId: string, to: { x: number; y: number }, done: () => void, response: number = DEFAULT_RESPONSE): void {
    const open = this.#open.get(agentId);
    if (!open || open.window.isDestroyed()) return;
    const [startX = to.x, startY = to.y] = open.window.getPosition();
    let x: SpringState = { position: startX, velocity: 0 };
    let y: SpringState = { position: startY, velocity: 0 };
    const size = orbSize(this.#find(agentId) ?? { attached: null });
    if (open.nudge) clearInterval(open.nudge);
    // The spring advances by the time that really passed, so a late timer tick moves the orb further
    // instead of slowing it down: the path stays smooth whatever the timer does.
    let last = performance.now();
    open.nudge = setInterval(() => {
      if (open.window.isDestroyed()) {
        if (open.nudge) clearInterval(open.nudge);
        return;
      }
      const now = performance.now();
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      x = springStep(x, to.x, seconds, response);
      y = springStep(y, to.y, seconds, response);
      const settled = springSettled(x, to.x) && springSettled(y, to.y);
      this.#setBounds(open, {
        x: settled ? to.x : Math.round(x.position),
        y: settled ? to.y : Math.round(y.position),
        ...size,
      });
      if (!settled) return;
      if (open.nudge) clearInterval(open.nudge);
      open.nudge = null;
      done();
    }, frameInterval(to));
  }

  /** Cancels a nudge in flight or waiting, and puts the orb back at its saved place unless a drag has it. */
  #stopNudge(agentId: string, restore = true): void {
    const open = this.#open.get(agentId);
    if (!open || (!open.nudge && !open.homeTimer && !open.visiting)) return;
    if (open.nudge) clearInterval(open.nudge);
    if (open.homeTimer) clearTimeout(open.homeTimer);
    open.nudge = null;
    open.homeTimer = null;
    open.visiting = false;
    if (open.seated) {
      open.seated = false;
      this.#cueMotion(agentId, { agentId, cue: "rest" });
    }
    const bubble = this.#find(agentId);
    if (restore && bubble && !open.window.isDestroyed()) this.#applyBounds(open, bubble);
  }

  /** Moves a dragged orb. Only the orb's own window may drag it. */
  dragTo(agentId: string, point: BubbleDragPoint): void {
    const open = this.#open.get(agentId);
    if (!open || open.window.isDestroyed()) return;
    // The orb is grabbed where it is, even mid-nudge; it is not snapped home first.
    this.#stopNudge(agentId, false);
    open.dragging = true;
    // Moving on, or letting go of Option, disarms the attach hint; a tremor of a few points does not.
    const moved = open.dwellAt && Math.hypot(point.x - open.dwellAt.x, point.y - open.dwellAt.y) > DWELL_TOLERANCE;
    if (open.dwellAt && (moved || !point.attach)) {
      open.dwellAt = null;
      this.#attachHandler?.disarm(agentId);
    }
    if (open.dwellTimer) clearTimeout(open.dwellTimer);
    open.dwellTimer = point.attach
      ? setTimeout(() => {
          open.dwellTimer = null;
          if (!open.dragging || open.dwellAt) return;
          open.dwellAt = { x: point.x, y: point.y };
          this.#attachHandler?.dwell(agentId, this.#orbCentre(agentId, point));
        }, DWELL_MS)
      : null;
    // Position only: the size does not change mid-drag, and a resize per frame would make it judder.
    open.settingBounds = true;
    open.window.setPosition(point.x, point.y);
    open.settingBounds = false;
  }

  dragEnd(agentId: string, attach: boolean): void {
    const open = this.#open.get(agentId);
    if (!open || open.window.isDestroyed()) return;
    const wasDragging = open.dragging;
    open.dragging = false;
    if (open.dwellTimer) clearTimeout(open.dwellTimer);
    open.dwellTimer = null;
    open.dwellAt = null;
    if (!wasDragging) return;
    const [x = 0, y = 0] = open.window.getPosition();
    this.#update(agentId, (bubble) => ({ ...bubble, x, y }));
    // The orb stays exactly where it was let go; only an Option-drop attaches (and snaps).
    this.#attachHandler?.release(agentId, attach, this.#orbCentre(agentId, { x, y }));
  }

  /** Sets a bubble's state from outside, such as an attach. Main moves the window to match. */
  replace(agentId: string, change: (bubble: BubbleState) => BubbleState): void {
    this.#update(agentId, change);
  }

  /** Closes the bubbles of agents that no longer exist. */
  reconcileAgents(): void {
    const agents = new Set(this.#options.listAgents().map((agent) => agent.id));
    for (const bubble of this.#state.bubbles) if (!agents.has(bubble.agentId)) this.close(bubble.agentId);
    this.#syncTray();
  }

  setTrayIcon(icon: NativeImage): void {
    this.#trayIcon = icon;
    this.#tray?.setImage(trayImage(icon));
  }

  /** The menu is built again on a language change: a native label cannot change in place. */
  relabel(): void {
    this.#syncTray();
  }

  /**
   * A display that goes away (a disconnected monitor, a closed lid) takes no orb with it: every orb
   * is kept on a display that remains, the primary one when its own is gone. Once, after app ready.
   */
  #watchDisplays(): void {
    if (this.#displaysWatched) return;
    this.#displaysWatched = true;
    const reclamp = () => {
      if (this.#destroyed) return;
      const workAreas = this.#workAreas();
      for (const bubble of this.#state.bubbles) {
        const next = clampOrb(bubble, workAreas);
        if (next.x !== bubble.x || next.y !== bubble.y)
          this.#update(bubble.agentId, (current) => ({ ...current, ...next }));
      }
    };
    screen.on("display-removed", reclamp);
    screen.on("display-metrics-changed", reclamp);
    this.#unwatchDisplays = () => {
      screen.off("display-removed", reclamp);
      screen.off("display-metrics-changed", reclamp);
    };
  }

  destroy(): void {
    this.#destroyed = true;
    this.#unwatchDisplays();
    if (this.#shortcutRegistered) globalShortcut.unregister(BUBBLES_TOGGLE_SHORTCUT);
    this.#shortcutRegistered = false;
    this.#tray?.destroy();
    this.#tray = null;
    for (const open of this.#open.values()) {
      if (open.nudge) clearInterval(open.nudge);
      if (open.homeTimer) clearTimeout(open.homeTimer);
      if (!open.window.isDestroyed()) open.window.destroy();
    }
    this.#open.clear();
  }

  #find(agentId: string): BubbleState | undefined {
    return this.#state.bubbles.find((bubble) => bubble.agentId === agentId);
  }

  #update(agentId: string, change: (bubble: BubbleState) => BubbleState): void {
    const current = this.#find(agentId);
    if (!current) return;
    const next = change(copyBubble(current));
    this.#state = {
      ...this.#state,
      bubbles: this.#state.bubbles.map((bubble) => (bubble.agentId === agentId ? next : bubble)),
    };
    const open = this.#open.get(agentId);
    // A drag, work in progress or a seat at a show holds the window where it is; it settles when they end.
    if (open && !open.dragging && !open.working && !open.seated) this.#applyBounds(open, next);
    this.#afterChange(true);
  }

  #remove(agentId: string): void {
    this.#open.delete(agentId);
    if (!this.#find(agentId)) return;
    this.#state = { ...this.#state, bubbles: this.#state.bubbles.filter((bubble) => bubble.agentId !== agentId) };
    this.#afterChange(true);
  }

  #workAreas(): BubbleBounds[] {
    const primary = screen.getPrimaryDisplay();
    return [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)].map(
      (display) => display.workArea,
    );
  }

  #boundsFor(bubble: BubbleState): BubbleBounds {
    return bubble.expanded
      ? expandedBounds(bubble, this.#workAreas())
      : { x: bubble.x, y: bubble.y, ...orbSize(bubble) };
  }

  #setBounds(open: OpenBubble, bounds: BubbleBounds): void {
    open.settingBounds = true;
    open.window.setBounds(bounds);
    open.settingBounds = false;
  }

  #applyBounds(open: OpenBubble, bubble: BubbleState): void {
    if (open.window.isDestroyed()) return;
    open.window.setResizable(bubble.expanded);
    open.window.setHasShadow(bubble.expanded);
    const maxWidth = BUBBLE_LIMITS.maxExpandedWidth + PANEL_OFFSET.x;
    const maxHeight = BUBBLE_LIMITS.maxExpandedHeight + PANEL_OFFSET.y;
    open.window.setMaximumSize(maxWidth, maxHeight);
    open.window.setMinimumSize(1, 1);
    const target = this.#boundsFor(bubble);
    const opening = bubble.expanded !== open.shownExpanded;
    open.shownExpanded = bubble.expanded;
    if (!opening) {
      this.#setBounds(open, target);
      this.#settleSizeLimits(open, bubble);
      return;
    }
    // Open and close as one liquid motion: the frame grows out of (or shrinks into) the orb's corner on
    // a spring, at the display rate, while the page morphs the panel out of the orb's circle.
    this.#morphBounds(open, target, () => this.#settleSizeLimits(open, bubble));
  }

  #settleSizeLimits(open: OpenBubble, bubble: BubbleState): void {
    if (open.window.isDestroyed() || !bubble.expanded) return;
    open.window.setMinimumSize(
      BUBBLE_LIMITS.minExpandedWidth + PANEL_OFFSET.x,
      BUBBLE_LIMITS.minExpandedHeight + PANEL_OFFSET.y,
    );
  }

  /** Animates the whole frame (position and size) on the spring, without saving anything. */
  #morphBounds(open: OpenBubble, to: BubbleBounds, done: () => void): void {
    if (open.window.isDestroyed()) return;
    if (open.morph) clearInterval(open.morph);
    const from = open.window.getBounds();
    const axes = (["x", "y", "width", "height"] as const).map((key) => ({
      key,
      state: { position: from[key], velocity: 0 } satisfies SpringState,
    }));
    let last = performance.now();
    open.morph = setInterval(() => {
      if (open.window.isDestroyed()) {
        if (open.morph) clearInterval(open.morph);
        return;
      }
      const now = performance.now();
      const seconds = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const axis of axes) axis.state = springStep(axis.state, to[axis.key], seconds, MORPH_RESPONSE);
      const settled = axes.every((axis) => springSettled(axis.state, to[axis.key]));
      const frame = Object.fromEntries(
        axes.map((axis) => [axis.key, settled ? to[axis.key] : Math.round(axis.state.position)]),
      );
      this.#setBounds(open, {
        x: frame.x ?? to.x,
        y: frame.y ?? to.y,
        width: Math.max(1, frame.width ?? to.width),
        height: Math.max(1, frame.height ?? to.height),
      });
      if (!settled) return;
      if (open.morph) clearInterval(open.morph);
      open.morph = null;
      done();
    }, frameInterval(to));
  }

  #openWindow(bubble: BubbleState): void {
    const bounds = this.#boundsFor(bubble);
    const window = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: bubble.expanded,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: bubble.expanded,
      alwaysOnTop: true,
      icon: this.#options.appIconPath,
      title: this.#agentName(bubble.agentId),
      webPreferences: {
        preload: join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        devTools: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const open: OpenBubble = {
      window,
      settingBounds: false,
      dragging: false,
      nudge: null,
      homeTimer: null,
      lastNudgeAt: 0,
      visiting: false,
      morph: null,
      shownExpanded: bubble.expanded,
      working: false,
      lastVisitAt: 0,
      dwellTimer: null,
      dwellAt: null,
    };
    this.#open.set(bubble.agentId, open);
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.setMenuBarVisibility(false);
    window.once("ready-to-show", () => {
      if (!this.#state.hidden) window.showInactive();
    });
    // Only main closes a bubble (Close, Bring back, a deleted agent, a quit). A close from the page,
    // such as Cmd+W or the chat window's own close when its agent list reloads, collapses it instead.
    window.on("close", (event) => {
      if (this.#options.isQuitting() || this.#destroyed) return;
      event.preventDefault();
      if (this.#find(bubble.agentId)?.expanded) this.setExpanded(bubble.agentId, false);
    });
    // The panel header is a drag region, so the window moves itself while it is expanded.
    // Only the expanded panel moves itself (its header is a drag region). A collapsed orb moves only
    // through main, which saves its own moves, so a late `moved` from one of those is ignored.
    window.on("moved", () => {
      if (open.settingBounds || open.dragging || !this.#find(bubble.agentId)?.expanded) return;
      const [x = 0, y = 0] = window.getPosition();
      // The window's corner is the orb's corner, expanded or not.
      this.#updateSilently(bubble.agentId, (current) => ({ ...current, x, y }));
    });
    window.on("resized", () => {
      const current = this.#find(bubble.agentId);
      if (open.settingBounds || !current?.expanded) return;
      const [outerWidth = current.width + PANEL_OFFSET.x, outerHeight = current.height + PANEL_OFFSET.y] =
        window.getSize();
      const width = outerWidth - PANEL_OFFSET.x;
      const height = outerHeight - PANEL_OFFSET.y;
      this.#updateSilently(bubble.agentId, (state) => ({ ...state, width, height }));
    });
    window.on("closed", () => {
      if (open.nudge) clearInterval(open.nudge);
      if (open.homeTimer) clearTimeout(open.homeTimer);
      if (open.dwellTimer) clearTimeout(open.dwellTimer);
      if (open.morph) clearInterval(open.morph);
      if (this.#open.get(bubble.agentId)?.window !== window) return;
      // A quit closes every window; the bubbles must come back on the next start.
      if (this.#options.isQuitting() || this.#destroyed) {
        this.#open.delete(bubble.agentId);
        return;
      }
      this.#open.delete(bubble.agentId);
      // `close()` removed the state before it destroyed the window, so a bubble that is still in the
      // state lost its renderer: open it again once in a while, else give it up.
      const current = this.#find(bubble.agentId);
      const agentExists = this.#options.listAgents().some((agent) => agent.id === bubble.agentId);
      const now = Date.now();
      if (current && agentExists && now - (this.#lastReopen.get(bubble.agentId) ?? 0) > REOPEN_WINDOW_MS) {
        this.#lastReopen.set(bubble.agentId, now);
        this.#openWindow(current);
        return;
      }
      this.#remove(bubble.agentId);
    });
    window.webContents.on("render-process-gone", () => {
      if (!window.isDestroyed()) window.destroy();
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    const url = appRendererUrl(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("window", "bubble");
    url.searchParams.set("server", LOCAL_SERVER_ID);
    url.searchParams.set("agent", bubble.agentId);
    window.loadURL(url.toString()).catch((error: unknown) => {
      logger.error("Could not load a bubble:", toLogValue(error));
      if (!window.isDestroyed()) window.destroy();
    });
  }

  /** A move or resize that the window made itself: save it, but do not move the window again. */
  #updateSilently(agentId: string, change: (bubble: BubbleState) => BubbleState): void {
    const current = this.#find(agentId);
    if (!current) return;
    const next = change(copyBubble(current));
    // While expanded, the orb anchor follows the panel's corner.
    const separated = next.expanded ? next : { ...next, ...separateOrb(next, this.#others(agentId)) };
    this.#state = {
      ...this.#state,
      bubbles: this.#state.bubbles.map((bubble) => (bubble.agentId === agentId ? separated : bubble)),
    };
    this.#afterChange(true);
  }

  #others(agentId: string): BubbleState[] {
    return this.#state.bubbles.filter((bubble) => bubble.agentId !== agentId);
  }

  #afterChange(persist: boolean): void {
    if (this.#destroyed) return;
    if (persist) {
      void Effect.runPromise(
        this.#store
          .set(this.#state)
          .pipe(
            Effect.catch((error) =>
              Effect.sync(() => logger.warn("Could not save the bubbles:", toLogValue(error.cause))),
            ),
          ),
      );
    }
    const snapshot = this.snapshot();
    for (const window of BrowserWindow.getAllWindows()) sendToRenderer(window, IPC_ENDPOINTS.bubbles.changed, snapshot);
    this.#syncTray();
    this.#syncShortcut();
  }

  #agentName(agentId: string): string {
    return this.#options.listAgents().find((agent) => agent.id === agentId)?.name ?? agentId;
  }

  #syncShortcut(): void {
    const wanted = this.hasBubbles();
    if (wanted === this.#shortcutRegistered) return;
    if (!wanted) {
      globalShortcut.unregister(BUBBLES_TOGGLE_SHORTCUT);
      this.#shortcutRegistered = false;
      return;
    }
    this.#shortcutRegistered = globalShortcut.register(BUBBLES_TOGGLE_SHORTCUT, () => this.toggleHidden());
    if (!this.#shortcutRegistered)
      logger.warn(`Another app holds ${BUBBLES_TOGGLE_SHORTCUT}; the bubbles shortcut is off.`);
  }

  #syncTray(): void {
    if (!this.hasBubbles()) {
      this.#tray?.destroy();
      this.#tray = null;
      return;
    }
    const translate = this.#options.translate();
    if (!this.#tray) {
      const icon = this.#trayIcon;
      if (!icon) return;
      this.#tray = new Tray(trayImage(icon));
    }
    this.#tray.setToolTip(translate("bubbles.trayTooltip"));
    this.#tray.setContextMenu(
      Menu.buildFromTemplate([
        ...this.#state.bubbles.map((bubble) => ({
          label: this.#agentName(bubble.agentId),
          click: () => {
            this.setHidden(false);
            this.setExpanded(bubble.agentId, true);
          },
        })),
        { type: "separator" as const },
        {
          label: translate("bubbles.trayNudges"),
          type: "checkbox" as const,
          checked: this.#state.nudges,
          click: () => this.setNudges(!this.#state.nudges),
        },
        {
          label: translate(this.#state.hidden ? "bubbles.trayShowAll" : "bubbles.trayHideAll"),
          accelerator: BUBBLES_TOGGLE_SHORTCUT,
          click: () => this.toggleHidden(),
        },
        { label: translate("bubbles.trayOpenMain"), click: () => this.#options.focusMainWindow("") },
        { type: "separator" as const },
        { label: translate("bubbles.trayQuit"), click: this.#options.quit },
      ]),
    );
  }
}

/** The app entry. `main-window.ts` keeps its copy private; a bubble loads the same page. */
function appRendererUrl(developmentUrl: string | undefined): URL {
  return developmentUrl ? new URL(developmentUrl) : new URL("openbot-app://app/index.html");
}

function trayImage(source: NativeImage): NativeImage {
  const size = process.platform === "win32" ? 16 : process.platform === "darwin" ? 18 : 32;
  const icon = source.resize({ width: size, height: size, quality: "best" });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: size * 2, height: size * 2, quality: "best" }).toPNG(),
  });
  return icon;
}
