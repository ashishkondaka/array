// Drag-to-attach: a bubble dropped on another app's window attaches its agent to that window.
//
// The window under the pointer comes from the Computer Use driver's own window list, over the
// daemon that OpenBot spawned, so the macOS grants stay OpenBot's. Attaching only changes what the
// agent is told each turn (`attached-window-context.ts`); every action it then takes goes through
// the normal Computer Use tools and the agent's approval policy.

import {
  BUBBLE_LIMITS,
  type BubbleAttachIssue,
  type BubbleBounds,
  type ComputerUseState,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { setAttachedWindowSource } from "../../backend/bubbles/attached-window-context";
import { type GoToAppResult, setDesktopWorkerHost } from "../../backend/bubbles/desktop-worker";
import {
  appWindow,
  attachedSurface,
  type DesktopWindow,
  dropOutcome,
  dropTarget,
  findApp,
  followAttachment,
  frontWindow,
  isKnownBrowser,
  readBrowserAddress,
  readDesktopApps,
  readDesktopWindows,
  snappedPosition,
} from "./attach-target";
import { separateOrb } from "./bubble-layout";
import type { BubbleWindowManager } from "./bubble-window-manager";
import { detectScene, NO_SCENE, nextSceneState, type SceneState, sameStage } from "./scenes";

const logger = createOpenBotLogger("bubbles-attach");

/** How often an attached bubble looks for its window: to follow a move and to notice a close. */
const FOLLOW_INTERVAL_MS = 2_000;
/** An attached orb is wider: its chip sits left of it. */
const ATTACHED_WIDTH_DELTA = BUBBLE_LIMITS.attachedOrbWidth - BUBBLE_LIMITS.orbSize;

export interface WindowReads {
  listWindows: () => Effect.Effect<unknown, unknown>;
  windowState: (pid: number, windowId: number, query: string) => Effect.Effect<unknown, unknown>;
  listApps: () => Effect.Effect<unknown, unknown>;
}

/** A trip to an app's window ends by itself when a drag or a close cuts it short. */
const JOURNEY_TIMEOUT_MS = 6_000;
/** How often the desktop is read for a show. Only a tick that finds a free orb reads anything. */
const SCENE_TICK_MS = 4_000;

export interface BubbleAttachOptions {
  bubbles: BubbleWindowManager;
  reads: WindowReads;
  /** Whether the driver is up with its grants, so its window list can be read. */
  driverReady: () => boolean;
  driverState: () => ComputerUseState;
  ownPid: number;
  /** The driver's ids for the bubble windows (the CGWindowID on macOS, the HWND on Windows). */
  bubbleWindowIds: () => Set<number>;
  /** The driver reports physical pixels on Windows; Electron places windows in DIP. */
  toDesktopRect: (rect: BubbleBounds) => BubbleBounds;
  openInBrowser: (agentId: string, url: string) => Effect.Effect<unknown, unknown>;
  /**
   * The agent's last Computer Use action, from the driver tap: which window it aimed at and where,
   * in desktop points. Null when nothing acted recently.
   */
  observedWork: () => ObservedWork | null;
  reportIssue: (agentId: string, issue: BubbleAttachIssue | null) => void;
}

export interface ObservedWork {
  pid: number | null;
  windowId: number | null;
  point: { x: number; y: number } | null;
}

/** How often the orb checks where its agent acts. In memory only; it runs only while attached. */
const WORK_TICK_MS = 120;
/** The orb drifts to a new action point only when it moved this far, so it does not jitter. */
const WORK_MOVE_MIN = 16;

export function attachIssue(state: ComputerUseState): BubbleAttachIssue {
  if (state.status === "unsupported") return "unsupported-platform";
  if (state.status === "permissions-required") {
    const missing = state.permissions.find((permission) => !permission.granted);
    return missing?.id === "accessibility" ? "permission-accessibility" : "permission-screen-recording";
  }
  return "driver-unavailable";
}

export class BubbleAttachController {
  readonly #options: BubbleAttachOptions;
  #follow: ReturnType<typeof setInterval> | null = null;
  #workTick: ReturnType<typeof setInterval> | null = null;
  #sceneTick: ReturnType<typeof setInterval> | null = null;
  #scene: SceneState = NO_SCENE;
  /** Where each working orb was last sent, by agent. */
  readonly #workingAt = new Map<string, { x: number; y: number }>();

  /** The window each dragged bubble rests over, which a release attaches it to. */
  readonly #armed = new Map<string, DesktopWindow>();

  constructor(options: BubbleAttachOptions) {
    this.#options = options;
    options.bubbles.setAttachHandler({
      dwell: (agentId, pointer) => void Effect.runPromise(this.#dwell(agentId, pointer)),
      disarm: (agentId) => this.#disarm(agentId),
      release: (agentId, attach, pointer) => this.#release(agentId, attach, pointer),
    });
    setAttachedWindowSource((agentId) => options.bubbles.bubble(agentId)?.attached ?? null);
    // The agent's `go_to_app` tool, and whether its turn gets the desktop block.
    setDesktopWorkerHost({
      goToApp: (agentId, app) => this.goToApp(agentId, app),
      freeBubble: (agentId) => {
        const bubble = options.bubbles.bubble(agentId);
        return bubble !== null && bubble.attached === null;
      },
    });
    options.bubbles.setFrontWindowSource(() =>
      options.driverReady()
        ? Effect.runPromise(
            this.#windows().pipe(
              Effect.map((windows) => frontWindow(windows, options.bubbleWindowIds())?.bounds ?? null),
              Effect.catch(() => Effect.succeed(null)),
            ),
          )
        : Promise.resolve(null),
    );
    this.#syncFollow();
    this.#sceneTick = setInterval(() => void Effect.runPromise(this.#sceneStep()), SCENE_TICK_MS);
  }

  detach(agentId: string): void {
    this.#options.bubbles.replace(agentId, (bubble) =>
      // The orb stays where its right end was: an attached orb is wider, with its chip to the left.
      bubble.attached ? { ...bubble, attached: null, x: bubble.x + ATTACHED_WIDTH_DELTA } : bubble,
    );
    this.#syncFollow();
  }

  openInBrowser(agentId: string): Effect.Effect<void> {
    const url = this.#options.bubbles.bubble(agentId)?.attached?.browserUrl;
    if (!url) return Effect.void;
    return this.#options.openInBrowser(agentId, url).pipe(
      Effect.asVoid,
      Effect.catch((error) => Effect.sync(() => logger.warn("Could not open the page in OpenBot:", toLogValue(error)))),
    );
  }

  stop(): void {
    if (this.#follow) clearInterval(this.#follow);
    if (this.#workTick) clearInterval(this.#workTick);
    this.#follow = null;
    this.#workTick = null;
  }

  /** Stops every timer, the scene watch included: the controller is done. */
  dispose(): void {
    this.stop();
    if (this.#sceneTick) clearInterval(this.#sceneTick);
    this.#sceneTick = null;
  }

  /**
   * One look at the desktop for a show. Nothing is read unless a free orb could take a seat, so a
   * desktop with no bubbles, or with every bubble busy, costs nothing. A show that settles seats the
   * audience; a stage that moves re-seats it; a show that ends sends it home.
   */
  #sceneStep(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const bubbles = this.#options.bubbles;
      if (!this.#options.driverReady() || !bubbles.canStage()) {
        if (this.#scene.current) bubbles.setScene(null);
        this.#scene = NO_SCENE;
        return;
      }
      const windows = yield* this.#windows();
      const detected = detectScene(
        windows,
        this.#options.ownPid,
        this.#options.bubbleWindowIds(),
        bubbles.displayBounds(),
      );
      const before = this.#scene.current;
      this.#scene = nextSceneState(this.#scene, detected);
      const now = this.#scene.current;
      if (!sameStage(before, now)) {
        if (now) logger.info(`A show started: ${now.window.appName} — ${now.window.title.slice(0, 60)}`);
        else logger.info("The show ended; the bubbles go home.");
      }
      if (!now) {
        if (before) bubbles.setScene(null);
        return;
      }
      const moved =
        !sameStage(before, now) || JSON.stringify(before?.window.bounds) !== JSON.stringify(now.window.bounds);
      // A show that holds still seats a newcomer too: an orb that just finished its work.
      if (moved || bubbles.canStage()) bubbles.setScene({ stage: now.window.bounds });
    }).pipe(Effect.catch(() => Effect.void));
  }

  /**
   * The agent sends its bubble to an app: the orb flies by the Dock to the app's front window and
   * attaches there, and the agent is told the window. An app with no window on screen is reported,
   * running or not, so the agent can open one with its own Computer Use tools; nothing is launched
   * here. The answer never fails: each reason is a result the agent can read and act on.
   */
  goToApp(agentId: string, app: string): Effect.Effect<GoToAppResult> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#options.bubbles.bubble(agentId)) return { status: "no-bubble" } as const;
      if (!this.#options.driverReady()) {
        const issue = attachIssue(this.#options.driverState());
        this.#options.reportIssue(agentId, issue);
        return { status: "driver-unavailable", reason: issue } as const;
      }
      const windows = yield* this.#windows();
      const window = appWindow(windows, app, this.#options.ownPid, this.#options.bubbleWindowIds());
      if (!window) {
        const found = findApp(readDesktopApps(yield* this.#options.reads.listApps()), app);
        if (!found) return { status: "unknown-app", app } as const;
        return found.running
          ? ({ status: "no-window", app: found.name, pid: found.pid, bundleId: found.bundleId } as const)
          : ({
              status: "not-running",
              app: found.name,
              bundleId: found.bundleId,
              launchPath: found.launchPath,
            } as const);
      }
      this.#options.reportIssue(agentId, null);
      yield* this.#travelTo(agentId, window);
      if (!this.#options.bubbles.bubble(agentId)) return { status: "no-bubble" } as const;
      yield* this.#attach(agentId, window, true);
      return {
        status: "attached",
        app: window.appName,
        title: window.title,
        pid: window.pid,
        windowId: window.windowId,
        bounds: { ...window.bounds },
        browserUrl: this.#options.bubbles.bubble(agentId)?.attached?.browserUrl ?? null,
      } as const;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          logger.warn("Could not send a bubble to an app:", toLogValue(error));
          return { status: "failed", message: String(toLogValue(error)) } as const;
        }),
      ),
    );
  }

  /** The orb's trip: by the Dock (where the app's icon is), then onto the window's corner. */
  #travelTo(agentId: string, window: DesktopWindow): Effect.Effect<void> {
    const corner = snappedPosition(window.bounds);
    const dock = this.#options.bubbles.dockStopNear(corner);
    const stops = dock ? [dock, corner] : [corner];
    return Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, JOURNEY_TIMEOUT_MS);
          this.#options.bubbles.journey(agentId, stops, () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    );
  }

  /** The orb follows its agent's actions on the attached window, and goes back to the corner after. */
  #followWork(): void {
    const work = this.#options.observedWork();
    for (const bubble of this.#options.bubbles.snapshot().bubbles) {
      const surface = bubble.attached;
      if (!surface) continue;
      const onThisWindow =
        work && (work.windowId === surface.windowId || (work.windowId === null && work.pid === surface.pid));
      if (!onThisWindow) {
        if (this.#workingAt.delete(bubble.agentId)) this.#options.bubbles.workAt(bubble.agentId, null);
        continue;
      }
      // A step with no point (typing, a key press) keeps the orb over the top of the window.
      const point = work.point ?? {
        x: surface.bounds.x + surface.bounds.width / 2,
        y: surface.bounds.y + BUBBLE_LIMITS.orbSize + 24,
      };
      const last = this.#workingAt.get(bubble.agentId);
      if (last && Math.hypot(last.x - point.x, last.y - point.y) < WORK_MOVE_MIN) continue;
      this.#workingAt.set(bubble.agentId, point);
      this.#options.bubbles.workAt(bubble.agentId, point);
    }
  }

  #windows(): Effect.Effect<DesktopWindow[], unknown> {
    return this.#options.reads.listWindows().pipe(
      Effect.map((payload) =>
        readDesktopWindows(payload).map((window) => ({
          ...window,
          bounds: this.#options.toDesktopRect(window.bounds),
        })),
      ),
    );
  }

  /** The pointer rested mid-drag: find the window under it and arm the attach, with a hint. */
  #dwell(agentId: string, pointer: { x: number; y: number }): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#options.driverReady()) {
        // Without the driver there is no window list. The bubble says what to turn on when opened.
        this.#options.reportIssue(agentId, attachIssue(this.#options.driverState()));
        return;
      }
      const windows = yield* this.#windows();
      const target = dropTarget(windows, pointer, this.#options.ownPid, this.#options.bubbleWindowIds());
      if (!target) return;
      this.#armed.set(agentId, target);
      this.#options.bubbles.sendAttachHint(agentId, target.appName || null);
    }).pipe(Effect.catch((error) => Effect.sync(() => logger.warn("Could not read the windows:", toLogValue(error)))));
  }

  #disarm(agentId: string): void {
    if (this.#armed.delete(agentId)) this.#options.bubbles.sendAttachHint(agentId, null);
  }

  /**
   * The drag ended. Without Option (Alt) it is a free placement: nothing attaches, and an attached
   * bubble dragged off detaches where it was let go. With it, the bubble attaches to the window it
   * rests over, found now if no hint was shown yet.
   */
  #release(agentId: string, attach: boolean, pointer: { x: number; y: number }): boolean {
    const armed = this.#armed.get(agentId) ?? null;
    this.#disarm(agentId);
    const bubble = this.#options.bubbles.bubble(agentId);
    if (!bubble) return false;
    if (!attach) {
      if (bubble.attached) this.detach(agentId);
      return false;
    }
    if (!this.#options.driverReady()) {
      this.#options.reportIssue(agentId, attachIssue(this.#options.driverState()));
      return false;
    }
    void Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const target =
          armed ?? dropTarget(yield* this.#windows(), pointer, this.#options.ownPid, this.#options.bubbleWindowIds());
        const outcome = dropOutcome(bubble, target);
        if (outcome.kind === "detach") this.detach(agentId);
        if (!target || outcome.kind === "detach" || outcome.kind === "none") return;
        this.#options.reportIssue(agentId, null);
        yield* this.#attach(agentId, target, outcome.kind === "attach");
      }).pipe(Effect.catch((error) => Effect.sync(() => logger.warn("Could not attach a bubble:", toLogValue(error))))),
    );
    return true;
  }

  #attach(agentId: string, window: DesktopWindow, fresh: boolean): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const bubble = this.#options.bubbles.bubble(agentId);
      if (!bubble) return;
      const browserUrl = fresh ? yield* this.#browserAddress(window) : (bubble.attached?.browserUrl ?? null);
      const others = this.#options.bubbles.snapshot().bubbles.filter((other) => other.agentId !== agentId);
      this.#options.bubbles.replace(agentId, (current) => ({
        ...current,
        attached: fresh ? attachedSurface(window, Date.now(), browserUrl) : current.attached,
        ...separateOrb(snappedPosition(window.bounds), others),
      }));
      this.#syncFollow();
    });
  }

  /** The page address of a known browser, or null. A failed read only loses the browser offer. */
  #browserAddress(window: DesktopWindow): Effect.Effect<string | null> {
    if (!isKnownBrowser(window.appName)) return Effect.succeed(null);
    return this.#options.reads.windowState(window.pid, window.windowId, "address").pipe(
      Effect.map(readBrowserAddress),
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  /** Polls only while a bubble is attached, so a desktop of free orbs costs nothing. */
  #syncFollow(): void {
    const attached = this.#options.bubbles.snapshot().bubbles.some((bubble) => bubble.attached);
    if (attached && !this.#follow) {
      this.#follow = setInterval(() => void Effect.runPromise(this.#followTick()), FOLLOW_INTERVAL_MS);
      this.#workTick = setInterval(() => this.#followWork(), WORK_TICK_MS);
    } else if (!attached) this.stop();
  }

  #followTick(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#options.driverReady()) return;
      const windows = yield* this.#windows();
      for (const bubble of this.#options.bubbles.snapshot().bubbles) {
        if (!bubble.attached) continue;
        const outcome = followAttachment(bubble.attached, windows);
        if (outcome.kind === "gone") this.detach(bubble.agentId);
        else if (outcome.kind === "moved") {
          this.#options.bubbles.replace(bubble.agentId, (current) =>
            current.attached
              ? {
                  ...current,
                  attached: { ...current.attached, bounds: outcome.bounds, title: outcome.title },
                  // An open panel stays where the user has it; a collapsed orb rides the window.
                  ...(current.expanded ? {} : snappedPosition(outcome.bounds)),
                }
              : current,
          );
        }
      }
      this.#syncFollow();
    }).pipe(Effect.catch(() => Effect.void));
  }
}
