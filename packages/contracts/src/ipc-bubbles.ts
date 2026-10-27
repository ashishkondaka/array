// Floating agent bubbles (OpenBot Bubbles fork). Each bubble is an always-on-top window of the local
// host for one agent: a collapsed orb or an expanded chat panel. Main owns the window, its saved
// state and the window it is attached to; the renderer only asks for changes.

import { integerInRange, isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const BUBBLE_LIMITS = {
  /** Bubbles open at once. Each one is a renderer process. */
  bubbles: 8,
  /** The collapsed orb window, a square. */
  orbSize: 72,
  /** The collapsed window when an attachment chip shows beside the orb. */
  attachedOrbWidth: 280,
  expandedWidth: 380,
  expandedHeight: 560,
  minExpandedWidth: 320,
  maxExpandedWidth: 720,
  minExpandedHeight: 360,
  maxExpandedHeight: 1_200,
  /** Desktop coordinates, in points. A multi-display layout can be far from the origin. */
  coordinate: 100_000,
  appName: 256,
  title: 1_024,
  bundleId: 256,
  url: 8_192,
  /** A pid or a window id. */
  systemId: 2_147_483_647,
} as const;

export interface BubbleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The external window that a bubble is attached to. */
export interface AttachedSurface {
  kind: "window";
  appName: string;
  /** The macOS bundle id, or null where the driver does not report one. */
  bundleId: string | null;
  title: string;
  pid: number;
  windowId: number;
  bounds: BubbleBounds;
  attachedAt: number;
  /** The page address when the window is a known browser and its address could be read. */
  browserUrl: string | null;
}

export interface BubbleState {
  agentId: string;
  /** The top-left corner of the orb, in desktop points. The expanded panel opens from this corner. */
  x: number;
  y: number;
  /** The expanded panel size. */
  width: number;
  height: number;
  expanded: boolean;
  attached: AttachedSurface | null;
}

export interface BubblesSnapshot {
  bubbles: BubbleState[];
  /** The global shortcut and the tray hide every bubble without closing it. */
  hidden: boolean;
}

/** Why an attach did not happen. The bubble shows the fix. */
export type BubbleAttachIssue =
  | "permission-screen-recording"
  | "permission-accessibility"
  | "driver-unavailable"
  | "unsupported-platform";

export interface BubbleAttachStatus {
  agentId: string;
  issue: BubbleAttachIssue | null;
}

/** Where a dragged orb is now: its top-left corner, in desktop points. */
export interface BubbleDragPoint {
  x: number;
  y: number;
}

export interface BubbleExpandedInput {
  agentId: string;
  expanded: boolean;
}

const ATTACH_ISSUES: readonly BubbleAttachIssue[] = [
  "permission-screen-recording",
  "permission-accessibility",
  "driver-unavailable",
  "unsupported-platform",
];

function isCoordinate(value: unknown): value is number {
  return integerInRange(value, -BUBBLE_LIMITS.coordinate, BUBBLE_LIMITS.coordinate);
}

export function isBubbleBounds(value: unknown): value is BubbleBounds {
  return (
    isDynamicRecord(value) &&
    isCoordinate(value.x) &&
    isCoordinate(value.y) &&
    integerInRange(value.width, 0, BUBBLE_LIMITS.coordinate) &&
    integerInRange(value.height, 0, BUBBLE_LIMITS.coordinate)
  );
}

export function isAttachedSurface(value: unknown): value is AttachedSurface {
  return (
    isDynamicRecord(value) &&
    value.kind === "window" &&
    isBoundedString(value.appName, BUBBLE_LIMITS.appName) &&
    isNullableBoundedString(value.bundleId, BUBBLE_LIMITS.bundleId) &&
    typeof value.title === "string" &&
    value.title.length <= BUBBLE_LIMITS.title &&
    integerInRange(value.pid, 1, BUBBLE_LIMITS.systemId) &&
    integerInRange(value.windowId, 0, BUBBLE_LIMITS.systemId) &&
    isBubbleBounds(value.bounds) &&
    integerInRange(value.attachedAt, 0, Number.MAX_SAFE_INTEGER) &&
    isNullableBoundedString(value.browserUrl, BUBBLE_LIMITS.url)
  );
}

export function isBubbleState(value: unknown): value is BubbleState {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    isCoordinate(value.x) &&
    isCoordinate(value.y) &&
    integerInRange(value.width, BUBBLE_LIMITS.minExpandedWidth, BUBBLE_LIMITS.maxExpandedWidth) &&
    integerInRange(value.height, BUBBLE_LIMITS.minExpandedHeight, BUBBLE_LIMITS.maxExpandedHeight) &&
    isBoolean(value.expanded) &&
    (value.attached === null || isAttachedSurface(value.attached))
  );
}

export function isBubblesSnapshot(value: unknown): value is BubblesSnapshot {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.bubbles) &&
    value.bubbles.length <= BUBBLE_LIMITS.bubbles &&
    value.bubbles.every(isBubbleState) &&
    isBoolean(value.hidden)
  );
}

export function isBubbleAttachStatus(value: unknown): value is BubbleAttachStatus {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    (value.issue === null || isOneOf(ATTACH_ISSUES, value.issue))
  );
}

export function isBubbleDragPoint(value: unknown): value is BubbleDragPoint {
  return isDynamicRecord(value) && isCoordinate(value.x) && isCoordinate(value.y);
}
