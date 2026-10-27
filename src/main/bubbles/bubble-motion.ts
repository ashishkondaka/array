// How an orb travels when it nudges the user: where it goes, and the spring that takes it there.
// No Electron here: main passes the pointer and the work areas, and drives the frames.

import { BUBBLE_LIMITS, type BubbleBounds } from "@openbot/contracts/ipc";
import { workAreaFor } from "./bubble-layout";

/** How far above the window's top edge the orb's centre hovers: over the title bar, not on it. */
const HOVER_LIFT = 12;
/** A nudge that would move the orb less than this stays home and only bobs. */
export const NUDGE_MIN_DISTANCE = 120;

/**
 * Where a nudging orb hovers: over the top centre of the app window in front, as if it came to
 * look at what the user is doing. With no window to go to, the top centre of the pointer's display.
 */
export function nudgeTarget(
  frontWindow: BubbleBounds | null,
  pointer: { x: number; y: number },
  workAreas: readonly BubbleBounds[],
): { x: number; y: number } {
  const size = BUBBLE_LIMITS.orbSize;
  const anchor = frontWindow ?? null;
  const area = workAreaFor(anchor ?? { x: pointer.x, y: pointer.y, width: 1, height: 1 }, workAreas);
  const x = anchor ? anchor.x + anchor.width / 2 - size / 2 : area.x + area.width / 2 - size / 2;
  const y = anchor ? anchor.y - size / 2 - HOVER_LIFT : area.y + HOVER_LIFT;
  return {
    x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - size)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - size)),
  };
}

/**
 * A critically damped spring, the default Apple uses for repositioning (damping 1.0, response 0.4 s):
 * no overshoot, it starts from where the orb is now and from its current speed, so a nudge can be
 * redirected mid-flight without a jump.
 */
export interface SpringState {
  position: number;
  velocity: number;
}

/** Apple's response for repositioning. A visit floats on a slower one (`VISIT_RESPONSE`). */
export const DEFAULT_RESPONSE = 0.4;
export const VISIT_RESPONSE = 1.1;
/** A bump: quick, so it reads as contact. */
export const BUMP_RESPONSE = 0.22;

export function springStep(
  state: SpringState,
  target: number,
  seconds: number,
  response: number = DEFAULT_RESPONSE,
): SpringState {
  const stiffness = (2 * Math.PI) / response;
  const offset = state.position - target;
  const decay = Math.exp(-stiffness * seconds);
  const slope = state.velocity + stiffness * offset;
  return {
    position: target + (offset + slope * seconds) * decay,
    velocity: (state.velocity - stiffness * slope * seconds) * decay,
  };
}

/** Settled: within half a point of the target and nearly still. */
export function springSettled(state: SpringState, target: number): boolean {
  return Math.abs(state.position - target) < 0.5 && Math.abs(state.velocity) < 5;
}

/** The gap between two orbs side by side on a visit. */
const VISIT_GAP = 6;

/**
 * Where a visitor stops beside the orb it visits: on the side it comes from, at the same height with
 * a little play, and on the partner's display.
 */
export function visitSpot(
  visitor: { x: number; y: number },
  partner: { x: number; y: number },
  workAreas: readonly BubbleBounds[],
  jitter: number,
): { x: number; y: number } {
  const size = BUBBLE_LIMITS.orbSize;
  const fromLeft = visitor.x <= partner.x;
  const x = partner.x + (fromLeft ? -(size + VISIT_GAP) : size + VISIT_GAP);
  const y = partner.y + Math.round(jitter * 12);
  const area = workAreaFor({ x: partner.x, y: partner.y, width: size, height: size }, workAreas);
  // At a display edge, the other side.
  const side =
    x < area.x || x + size > area.x + area.width ? partner.x + (fromLeft ? size + VISIT_GAP : -(size + VISIT_GAP)) : x;
  return {
    x: Math.round(Math.min(Math.max(side, area.x), area.x + area.width - size)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - size)),
  };
}

/** The bumped orb gives way: a short push straight away from the visitor. */
export function bumpOffset(
  visitor: { x: number; y: number },
  partner: { x: number; y: number },
): { x: number; y: number } {
  const dx = partner.x - visitor.x;
  const dy = partner.y - visitor.y;
  const length = Math.hypot(dx, dy) || 1;
  const push = 18;
  return { x: Math.round((dx / length) * push), y: Math.round((dy / length) * push) };
}
