// Window geometry of a bubble, without Electron: the main process passes the display work areas in.

import { BUBBLE_LIMITS, type BubbleBounds, type BubbleState } from "@openbot/contracts/ipc";

/** The gap between a bubble and a display edge, and between stacked bubbles. */
const MARGIN = 16;
/** How much of an orb must stay on a display for it to count as on that display. */
const VISIBLE_PART = 24;

export function orbSize(state: Pick<BubbleState, "attached">): { width: number; height: number } {
  return {
    width: state.attached ? BUBBLE_LIMITS.attachedOrbWidth : BUBBLE_LIMITS.orbSize,
    height: BUBBLE_LIMITS.orbSize,
  };
}

function intersection(a: BubbleBounds, b: BubbleBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function clampInto(rect: BubbleBounds, area: BubbleBounds): BubbleBounds {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  return {
    x: Math.round(Math.min(Math.max(rect.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(rect.y, area.y), area.y + area.height - height)),
    width,
    height,
  };
}

/** The work area that holds the largest part of `rect`, or the primary one. */
export function workAreaFor(rect: BubbleBounds, workAreas: readonly BubbleBounds[]): BubbleBounds {
  const [primary] = workAreas;
  if (!primary) return rect;
  let best = primary;
  let bestArea = 0;
  for (const area of workAreas) {
    const shared = intersection(rect, area);
    if (shared > bestArea) {
      best = area;
      bestArea = shared;
    }
  }
  return best;
}

/**
 * Keeps an orb on a display. An orb mostly off every display (its display was disconnected) moves
 * to the primary work area, the first one; otherwise it stays on the display it is on.
 */
export function clampOrb(state: BubbleState, workAreas: readonly BubbleBounds[]): { x: number; y: number } {
  const size = orbSize(state);
  const rect = { x: state.x, y: state.y, ...size };
  const [primary] = workAreas;
  if (!primary) return { x: state.x, y: state.y };
  const visible = workAreas.some((area) => intersection(rect, area) >= VISIBLE_PART * VISIBLE_PART);
  const area = visible ? workAreaFor(rect, workAreas) : primary;
  const clamped = clampInto(rect, area);
  return { x: clamped.x, y: clamped.y };
}

/**
 * The expanded panel opens from the orb's top-left corner and moves left or up only as far as it
 * must to fit the display, so the orb stays where the user put it.
 */
/**
 * Where the panel sits inside the window, whose corner stays at the orb's corner: the avatar button
 * in the panel header lands on the orb's centre, so the click that opened the panel, repeated in
 * place, closes it. The header avatar button is 40pt wide at 8pt from the left, in a 48pt header
 * (see `bubbles.css`); the orb's centre is half the orb size in from its corner. Keeping the corner
 * fixed is what lets the panel grow out of the orb without the orb jumping.
 */
export const PANEL_OFFSET = {
  x: BUBBLE_LIMITS.orbSize / 2 - (8 + 40 / 2),
  y: BUBBLE_LIMITS.orbSize / 2 - 48 / 2,
} as const;

export function expandedBounds(state: BubbleState, workAreas: readonly BubbleBounds[]): BubbleBounds {
  const rect = {
    x: state.x,
    y: state.y,
    width: state.width + PANEL_OFFSET.x,
    height: state.height + PANEL_OFFSET.y,
  };
  return clampInto(rect, workAreaFor({ x: state.x, y: state.y, ...orbSize(state) }, workAreas));
}

/**
 * Where a new orb goes: down the right edge of the primary display, below the bubbles there, so a
 * new orb never covers an open one.
 */
export function defaultOrbPosition(
  existing: readonly Pick<BubbleState, "x" | "y">[],
  workAreas: readonly BubbleBounds[],
): { x: number; y: number } {
  const [primary] = workAreas;
  if (!primary) return { x: MARGIN, y: MARGIN };
  const x = primary.x + primary.width - BUBBLE_LIMITS.orbSize - MARGIN;
  const step = BUBBLE_LIMITS.orbSize + MARGIN / 2;
  let y = primary.y + MARGIN * 6;
  while (existing.some((bubble) => Math.abs(bubble.x - x) < step && Math.abs(bubble.y - y) < step)) y += step;
  return clampInto({ x, y, width: BUBBLE_LIMITS.orbSize, height: BUBBLE_LIMITS.orbSize }, primary);
}

/**
 * Moves an orb off any other orb it would cover, downwards in steps. Two bubbles snapped to one
 * window would otherwise sit on top of each other.
 */
export function separateOrb(
  position: { x: number; y: number },
  others: readonly Pick<BubbleState, "x" | "y">[],
): { x: number; y: number } {
  const step = BUBBLE_LIMITS.orbSize + MARGIN / 2;
  let { y } = position;
  for (let tries = 0; tries < BUBBLE_LIMITS.bubbles; tries += 1) {
    if (!others.some((other) => Math.abs(other.x - position.x) < step && Math.abs(other.y - y) < step)) break;
    y += step;
  }
  return { x: position.x, y };
}
