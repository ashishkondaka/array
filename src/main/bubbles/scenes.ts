// Scenes: what the screen is doing, and how the idle bubbles react to it (OpenBot Bubbles fork).
// The first scene is the theater: a video in front (a player app, a video site in a browser, or any
// app gone full screen) seats every idle orb in a row along the stage and turns their eyes to it;
// when the video goes, they float home. No Electron here: main passes the driver's window list and
// the display geometry in, and the window manager does the moving.

import { BUBBLE_LIMITS, type BubbleBounds } from "@openbot/contracts/ipc";
import { type DesktopWindow, isKnownBrowser, stackedWindows } from "./attach-target";

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

/** A window with more than this share of it under other windows is not being watched. */
const COVERED_LIMIT = 0.5;
/** The grid that measures how much of a window the windows over it cover. */
const COVER_GRID = 24;

/** Whether a window plays a show: a player app, a video site in a browser, or full screen. */
function isShow(window: DesktopWindow, displays: readonly BubbleBounds[]): boolean {
  return (
    VIDEO_APPS.includes(window.appName) ||
    (isKnownBrowser(window.appName) && VIDEO_SITES.test(window.title)) ||
    isFullScreen(window, displays)
  );
}

/**
 * The share of `window` that `covers` hide, from 0 to 1, measured on a grid of sample points so
 * overlapping covers count once.
 */
export function coveredShare(window: BubbleBounds, covers: readonly BubbleBounds[]): number {
  if (covers.length === 0 || window.width <= 0 || window.height <= 0) return 0;
  let hidden = 0;
  for (let row = 0; row < COVER_GRID; row++) {
    const y = window.y + ((row + 0.5) / COVER_GRID) * window.height;
    for (let column = 0; column < COVER_GRID; column++) {
      const x = window.x + ((column + 0.5) / COVER_GRID) * window.width;
      if (
        covers.some((cover) => x >= cover.x && x < cover.x + cover.width && y >= cover.y && y < cover.y + cover.height)
      )
        hidden++;
    }
  }
  return hidden / (COVER_GRID * COVER_GRID);
}

/**
 * The scene the screen makes, or null: the frontmost show that is mostly in view. A small window
 * over a video (a chat, a terminal, a note) leaves the show on; a window that hides most of it (the
 * user's work, OpenBot's own window) ends it. A show behind another show is not the one watched.
 */
export function detectScene(
  windows: readonly DesktopWindow[],
  ownPid: number,
  bubbleWindowIds: ReadonlySet<number>,
  displays: readonly BubbleBounds[],
): Scene | null {
  const covers: BubbleBounds[] = [];
  for (const window of stackedWindows(windows, bubbleWindowIds)) {
    if (window.pid !== ownPid && isShow(window, displays)) {
      return coveredShare(window.bounds, covers) < COVERED_LIMIT ? { kind: "theater", window } : null;
    }
    covers.push(window.bounds);
  }
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

/** A scene must hold for this many ticks before the bubbles move: a glance at a video is not a show. */
export const SCENE_SETTLE_TICKS = 2;

export interface SceneState {
  /** The show the bubbles are at, or null. */
  current: Scene | null;
  /** What the last tick saw, and for how many ticks in a row. */
  candidate: Scene | null;
  streak: number;
}

export const NO_SCENE: SceneState = { current: null, candidate: null, streak: 0 };

/**
 * One tick: the detected scene becomes the current one after `SCENE_SETTLE_TICKS` ticks of the same
 * stage, and the current one ends after as many ticks without it. A stage that moved keeps the
 * show and the new bounds.
 */
export function nextSceneState(state: SceneState, detected: Scene | null): SceneState {
  const streak = sameStage(state.candidate, detected) ? state.streak + 1 : 1;
  const candidate = detected;
  if (sameStage(state.current, detected)) {
    return { current: detected, candidate, streak };
  }
  if (streak >= SCENE_SETTLE_TICKS) return { current: detected, candidate, streak };
  return { ...state, candidate, streak };
}
