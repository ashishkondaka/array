// How an orb travels when it nudges the user: where it goes, and the spring that takes it there.
// No Electron here: main passes the pointer and the work areas, and drives the frames.

import { BUBBLE_LIMITS, type BubbleBounds } from "@openbot/contracts/ipc";
import { workAreaFor } from "./bubble-layout";

/** How far from the pointer the orb stops: near enough to notice, not under the cursor. */
const NUDGE_OFFSET = { x: -BUBBLE_LIMITS.orbSize - 24, y: -BUBBLE_LIMITS.orbSize / 2 };
/** A nudge that would move the orb less than this stays home and only wiggles. */
export const NUDGE_MIN_DISTANCE = 120;

/** Where a nudging orb stops: beside the pointer, on the pointer's display. */
export function nudgeTarget(
  pointer: { x: number; y: number },
  workAreas: readonly BubbleBounds[],
): { x: number; y: number } {
  const size = BUBBLE_LIMITS.orbSize;
  const area = workAreaFor({ x: pointer.x, y: pointer.y, width: 1, height: 1 }, workAreas);
  let x = pointer.x + NUDGE_OFFSET.x;
  // Too close to the left edge: stop on the pointer's right instead.
  if (x < area.x) x = pointer.x + 24;
  const y = pointer.y + NUDGE_OFFSET.y;
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

const RESPONSE_SECONDS = 0.4;
const STIFFNESS = (2 * Math.PI) / RESPONSE_SECONDS;

export function springStep(state: SpringState, target: number, seconds: number): SpringState {
  const offset = state.position - target;
  const decay = Math.exp(-STIFFNESS * seconds);
  const slope = state.velocity + STIFFNESS * offset;
  return {
    position: target + (offset + slope * seconds) * decay,
    velocity: (state.velocity - STIFFNESS * slope * seconds) * decay,
  };
}

/** Settled: within half a point of the target and nearly still. */
export function springSettled(state: SpringState, target: number): boolean {
  return Math.abs(state.position - target) < 0.5 && Math.abs(state.velocity) < 5;
}
