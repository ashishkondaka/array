// Which window a dropped bubble attaches to, where it snaps, and what happens to an attachment when
// its window moves or closes. No Electron here: main passes the driver's window list and the pointer.

import { type AttachedSurface, BUBBLE_LIMITS, type BubbleBounds, type BubbleState } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/** Below this a window is a palette or a helper, not something to attach an agent to. */
const MINIMUM_TARGET_SIZE = 120;
/** The driver's own cursor overlay covers a display and is never a target. */
const DRIVER_OVERLAY_APP = "cua-driver";
/** The gap between an attached orb and its window's corner. */
const SNAP_INSET = 8;
/** Browsers whose page can move into the embedded browser. Names as macOS and Windows report them. */
const KNOWN_BROWSERS = [
  "Google Chrome",
  "Chrome",
  "Microsoft Edge",
  "Brave Browser",
  "Brave",
  "Arc",
  "Safari",
  "Firefox",
  "Chromium",
];

/** One window as the driver's `list_windows` reports it, in desktop points with a top-left origin. */
export interface DesktopWindow {
  windowId: number;
  pid: number;
  appName: string;
  title: string;
  bounds: BubbleBounds;
  /** Larger is nearer the front; null when the driver cannot tell. */
  zIndex: number | null;
  onScreen: boolean;
  onCurrentSpace: boolean;
}

function readBounds(value: unknown): BubbleBounds | null {
  if (!isDynamicRecord(value)) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
  return {
    x: Math.round(Number(x)),
    y: Math.round(Number(y)),
    width: Math.round(Number(width)),
    height: Math.round(Number(height)),
  };
}

/** Reads `list_windows`' structured payload. A record that does not parse is skipped. */
export function readDesktopWindows(payload: unknown): DesktopWindow[] {
  const records = isDynamicRecord(payload) && Array.isArray(payload.windows) ? payload.windows : [];
  return records.flatMap((record): DesktopWindow[] => {
    if (!isDynamicRecord(record)) return [];
    const bounds = readBounds(record.bounds);
    const { window_id: windowId, pid } = record;
    if (!bounds || !Number.isSafeInteger(windowId) || !Number.isSafeInteger(pid)) return [];
    return [
      {
        windowId: Number(windowId),
        pid: Number(pid),
        appName: typeof record.app_name === "string" ? record.app_name : "",
        title: typeof record.title === "string" ? record.title : "",
        bounds,
        zIndex: Number.isSafeInteger(record.z_index) ? Number(record.z_index) : null,
        onScreen: record.is_on_screen !== false,
        onCurrentSpace: record.on_current_space !== false,
      },
    ];
  });
}

function contains(bounds: BubbleBounds, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x < bounds.x + bounds.width &&
    point.y < bounds.y + bounds.height
  );
}

/**
 * The frontmost visible window under the pointer that is not too small to work in. The bubbles are
 * left out by window id: the dragged orb is always under the pointer. When another OpenBot window
 * (the main window) is in front, the drop was on OpenBot, not through it, and there is no target.
 * With no stacking order from the driver, its front-to-back list order stands in.
 */
export function dropTarget(
  windows: readonly DesktopWindow[],
  point: { x: number; y: number },
  ownPid: number,
  bubbleWindowIds: ReadonlySet<number>,
): DesktopWindow | null {
  const candidates = windows.filter(
    (window) =>
      !bubbleWindowIds.has(window.windowId) &&
      window.onScreen &&
      window.onCurrentSpace &&
      window.appName !== DRIVER_OVERLAY_APP &&
      window.bounds.width >= MINIMUM_TARGET_SIZE &&
      window.bounds.height >= MINIMUM_TARGET_SIZE &&
      contains(window.bounds, point),
  );
  if (candidates.length === 0) return null;
  const ranked = candidates.every((window) => window.zIndex !== null)
    ? [...candidates].sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
    : candidates;
  const [front] = ranked;
  return front && front.pid !== ownPid ? front : null;
}

/** The attached orb sits in the window's top-right corner; its chip reads leftwards from it. */
export function snappedPosition(bounds: BubbleBounds): { x: number; y: number } {
  return {
    x: bounds.x + bounds.width - BUBBLE_LIMITS.attachedOrbWidth - SNAP_INSET,
    y: bounds.y + SNAP_INSET,
  };
}

export function isKnownBrowser(appName: string): boolean {
  return KNOWN_BROWSERS.includes(appName);
}

function isWebAddress(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

/**
 * The page address in a browser window's accessibility tree (`get_window_state` with a query for the
 * address field). Browsers show the address without its scheme, so `https://` is assumed when the
 * value reads as a host name and path. Anything that is not a web address is null.
 */
export function readBrowserAddress(payload: unknown): string | null {
  const elements = isDynamicRecord(payload) && Array.isArray(payload.elements) ? payload.elements : [];
  for (const element of elements) {
    if (!isDynamicRecord(element) || typeof element.value !== "string") continue;
    const role = typeof element.role === "string" ? element.role : "";
    const label = typeof element.label === "string" ? element.label.toLowerCase() : "";
    if (!/text ?field|combo ?box|edit/iu.test(role) && !label.includes("address")) continue;
    const value = element.value.trim();
    if (value.length === 0 || value.length > BUBBLE_LIMITS.url || /\s/u.test(value)) continue;
    if (isWebAddress(value)) return value;
    const withScheme = `https://${value}`;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/u.test(value) && isWebAddress(withScheme)) return withScheme;
  }
  return null;
}

export function attachedSurface(window: DesktopWindow, attachedAt: number, browserUrl: string | null): AttachedSurface {
  return {
    kind: "window",
    appName: (window.appName || "App").slice(0, BUBBLE_LIMITS.appName),
    bundleId: null,
    title: window.title.slice(0, BUBBLE_LIMITS.title),
    pid: window.pid,
    windowId: window.windowId,
    bounds: { ...window.bounds },
    attachedAt,
    browserUrl,
  };
}

/** A bubble attaches to the drop target, stays, or detaches. */
export type DropOutcome =
  | { kind: "attach"; window: DesktopWindow }
  | { kind: "stay-attached" }
  | { kind: "detach" }
  | { kind: "none" };

export function dropOutcome(bubble: Pick<BubbleState, "attached">, target: DesktopWindow | null): DropOutcome {
  if (target) {
    return bubble.attached?.windowId === target.windowId
      ? { kind: "stay-attached" }
      : { kind: "attach", window: target };
  }
  // Dragged off its window onto the desktop or onto OpenBot: the attachment ends.
  return bubble.attached ? { kind: "detach" } : { kind: "none" };
}

/** What a periodic look at the window list means for an attachment. */
export type FollowOutcome =
  | { kind: "gone" }
  | { kind: "moved"; bounds: BubbleBounds; title: string }
  | { kind: "same" };

export function followAttachment(surface: AttachedSurface, windows: readonly DesktopWindow[]): FollowOutcome {
  const window = windows.find((candidate) => candidate.windowId === surface.windowId && candidate.pid === surface.pid);
  // A minimized window or one on another Space is still there; only a closed one detaches.
  if (!window) return { kind: "gone" };
  const { bounds } = window;
  const same =
    bounds.x === surface.bounds.x &&
    bounds.y === surface.bounds.y &&
    bounds.width === surface.bounds.width &&
    bounds.height === surface.bounds.height &&
    window.title === surface.title;
  return same ? { kind: "same" } : { kind: "moved", bounds, title: window.title.slice(0, BUBBLE_LIMITS.title) };
}
