// Scenes: what the screen is doing, and how the idle bubbles react to it (OpenBot Bubbles fork).
// The first scene is the theater: a video in front (a player app, a video site in a browser, or any
// app gone full screen) seats every idle orb in a row along the stage and turns their eyes to it;
// when the video goes, they float home. No Electron here: main passes the driver's window list and
// the display geometry in, and the window manager does the moving.

import { BUBBLE_LIMITS, type BubbleBounds } from "@openbot/contracts/ipc";
import { type DesktopWindow, frontWindow, isKnownBrowser } from "./attach-target";

export type SceneKind = "theater";

export interface Scene {
  kind: SceneKind;
  /** The window the bubbles react to: the stage. */
  window: DesktopWindow;
}

/** Players whose front window is a show, whatever its title. */
const VIDEO_APPS = ["QuickTime Player", "TV", "IINA", "VLC", "Infuse", "mpv", "Elmedia Player", "Movist", "Plex"];
/** A browser window title that names a video site. */
const VIDEO_SITES =
  /youtube|netflix|vimeo|twitch|prime video|disney\+|hulu|hbo|\bmax\b|apple tv|plex|crunchyroll|peacock|paramount\+|dailymotion/iu;
/** The gap between seats, and between the row and the stage. */
const SEAT_GAP = 12;

/** Whether a window fills a display: full screen is a show whatever the app. */
export function isFullScreen(window: DesktopWindow, displays: readonly BubbleBounds[]): boolean {
  return displays.some(
    (display) =>
      Math.abs(window.bounds.x - display.x) <= 1 &&
      Math.abs(window.bounds.y - display.y) <= 1 &&
      Math.abs(window.bounds.width - display.width) <= 2 &&
      Math.abs(window.bounds.height - display.height) <= 2,
  );
}

/**
 * The scene the front window makes, or null. Only the front window counts: a video behind the
 * user's work is not being watched.
 */
export function detectScene(
  windows: readonly DesktopWindow[],
  ownPid: number,
  bubbleWindowIds: ReadonlySet<number>,
  displays: readonly BubbleBounds[],
): Scene | null {
  const front = frontWindow(windows, bubbleWindowIds);
  if (!front || front.pid === ownPid) return null;
  const player = VIDEO_APPS.includes(front.appName);
  const site = isKnownBrowser(front.appName) && VIDEO_SITES.test(front.title);
  if (player || site || isFullScreen(front, displays)) return { kind: "theater", window: front };
  return null;
}

/**
 * The seats: a row of orbs centred on the stage, under its bottom edge when the work area has the
 * room, else above its top edge, else (a full-screen stage) a front row inside it along the bottom.
 * The row never leaves the work area; a row wider than it is clamped at both ends and overlaps.
 */
export function theaterSeats(stage: BubbleBounds, count: number, workArea: BubbleBounds): { x: number; y: number }[] {
  if (count <= 0) return [];
  const size = BUBBLE_LIMITS.orbSize;
  const step = size + SEAT_GAP;
  const below = stage.y + stage.height + SEAT_GAP;
  const above = stage.y - SEAT_GAP - size;
  const y =
    below + size <= workArea.y + workArea.height
      ? below
      : above >= workArea.y
        ? above
        : workArea.y + workArea.height - size - SEAT_GAP;
  const rowWidth = count * step - SEAT_GAP;
  const start = stage.x + stage.width / 2 - rowWidth / 2;
  const minX = workArea.x + SEAT_GAP;
  const maxX = workArea.x + workArea.width - size - SEAT_GAP;
  return Array.from({ length: count }, (_, index) => ({
    x: Math.round(Math.min(Math.max(start + index * step, minX), maxX)),
    y: Math.round(y),
  }));
}

/** Where an orb at `seat` looks: the unit direction to the stage's centre, for its eyes. */
export function gazeToward(seat: { x: number; y: number }, stage: BubbleBounds): { dx: number; dy: number } {
  const half = BUBBLE_LIMITS.orbSize / 2;
  const dx = stage.x + stage.width / 2 - (seat.x + half);
  const dy = stage.y + stage.height / 2 - (seat.y + half);
  const length = Math.hypot(dx, dy);
  if (length < 1) return { dx: 0, dy: 0 };
  return { dx: Number((dx / length).toFixed(3)), dy: Number((dy / length).toFixed(3)) };
}

/** Two scenes are the same show when the same window is the stage; a move of the window re-seats. */
export function sameStage(a: Scene | null, b: Scene | null): boolean {
  return a?.window.windowId === b?.window.windowId && a?.kind === b?.kind;
}
