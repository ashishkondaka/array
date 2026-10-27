// One always-on-top window for each bubble, its saved state, its drag and its tray menu.
//
// A bubble window loads the normal app with `?window=bubble&server=local&agent=<id>`. The renderer
// runs it as a chat window (#2964) and shows the orb or the compact panel. The window has the
// sandboxed preload, the navigation guard and the deny-all open handler of a chat window, and no
// other privilege.

import { join } from "node:path";
import {
  BUBBLE_LIMITS,
  type BubbleBounds,
  type BubbleDragPoint,
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
import { clampOrb, defaultOrbPosition, expandedBounds, orbSize, separateOrb } from "./bubble-layout";
import { BUBBLES_STATE_FILE, copyBubble, decodeBubblesFile, EMPTY_BUBBLES, newBubble } from "./bubble-state-file";
import { setBubbleWindowSource } from "./bubble-window-registry";

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
export type BubbleDropHandler = (agentId: string, pointer: { x: number; y: number }) => void;

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
  #dropHandler: BubbleDropHandler | null = null;
  #destroyed = false;
  readonly #lastReopen = new Map<string, number>();

  constructor(options: BubbleWindowManagerOptions) {
    this.#options = options;
    this.#store = new PreferenceStore<BubblesSnapshot>({
      path: join(options.userDataPath, BUBBLES_STATE_FILE),
      defaultValue: EMPTY_BUBBLES,
      decode: decodeBubblesFile,
    });
    setBubbleWindowSource(() => this.windows());
  }

  /** Reads the saved bubbles and opens each one whose agent still exists. */
  restore(): Effect.Effect<void> {
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
        hidden: saved.hidden,
        bubbles: saved.bubbles
          .filter((bubble) => agents.has(bubble.agentId))
          .map((bubble) => ({ ...copyBubble(bubble), ...clampOrb(bubble, workAreas) })),
      };
      for (const bubble of this.#state.bubbles) this.#openWindow(bubble);
      this.#afterChange(saved.bubbles.length !== this.#state.bubbles.length);
    });
  }

  snapshot(): BubblesSnapshot {
    return { hidden: this.#state.hidden, bubbles: this.#state.bubbles.map(copyBubble) };
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

  setDropHandler(handler: BubbleDropHandler): void {
    this.#dropHandler = handler;
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
    this.#state = { hidden: false, bubbles: [...this.#state.bubbles, bubble] };
    this.#openWindow(bubble);
    this.#afterChange(true);
  }

  close(agentId: string): void {
    const open = this.#open.get(agentId);
    this.#remove(agentId);
    if (open && !open.window.isDestroyed()) open.window.destroy();
  }

  setExpanded(agentId: string, expanded: boolean): void {
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

  /** Moves a dragged orb. Only the orb's own window may drag it. */
  dragTo(agentId: string, point: BubbleDragPoint): void {
    const open = this.#open.get(agentId);
    if (!open || open.window.isDestroyed()) return;
    open.dragging = true;
    this.#setBounds(open, { ...point, ...orbSize(this.#find(agentId) ?? { attached: null }) });
  }

  dragEnd(agentId: string): void {
    const open = this.#open.get(agentId);
    if (!open || open.window.isDestroyed()) return;
    const wasDragging = open.dragging;
    open.dragging = false;
    if (!wasDragging) return;
    const [x = 0, y = 0] = open.window.getPosition();
    this.#update(agentId, (bubble) => ({ ...bubble, x, y }));
    this.#dropHandler?.(agentId, screen.getCursorScreenPoint());
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

  destroy(): void {
    this.#destroyed = true;
    if (this.#shortcutRegistered) globalShortcut.unregister(BUBBLES_TOGGLE_SHORTCUT);
    this.#shortcutRegistered = false;
    this.#tray?.destroy();
    this.#tray = null;
    for (const open of this.#open.values()) if (!open.window.isDestroyed()) open.window.destroy();
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
    if (open && !open.dragging) this.#applyBounds(open, next);
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
    if (bubble.expanded) {
      open.window.setMinimumSize(BUBBLE_LIMITS.minExpandedWidth, BUBBLE_LIMITS.minExpandedHeight);
      open.window.setMaximumSize(BUBBLE_LIMITS.maxExpandedWidth, BUBBLE_LIMITS.maxExpandedHeight);
    } else {
      open.window.setMinimumSize(1, 1);
      open.window.setMaximumSize(BUBBLE_LIMITS.maxExpandedWidth, BUBBLE_LIMITS.maxExpandedHeight);
    }
    this.#setBounds(open, this.#boundsFor(bubble));
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
    const open: OpenBubble = { window, settingBounds: false, dragging: false };
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
    window.on("moved", () => {
      if (open.settingBounds || open.dragging) return;
      const [x = 0, y = 0] = window.getPosition();
      this.#updateSilently(bubble.agentId, (current) => ({ ...current, x, y }));
    });
    window.on("resized", () => {
      const current = this.#find(bubble.agentId);
      if (open.settingBounds || !current?.expanded) return;
      const [width = current.width, height = current.height] = window.getSize();
      this.#updateSilently(bubble.agentId, (state) => ({ ...state, width, height }));
    });
    window.on("closed", () => {
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
