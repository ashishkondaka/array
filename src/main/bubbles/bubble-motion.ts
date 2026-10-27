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

/** A pointer sample of a drag, in desktop points and milliseconds. */
export interface DragSample {
  x: number;
  y: number;
  at: number;
}

/** Only the last stretch of a drag says how fast it was released. */
const VELOCITY_WINDOW_MS = 100;
/** Below this the release is a placement, not a throw, and the orb stays where it was let go. */
export const THROW_MIN_SPEED = 400;
/** Apple's scroll-style projection, a little snappier than a page (0.998) so the orb does not fly far. */
const DECELERATION = 0.995;

/** The release velocity in points per second, from the samples of the last 100 ms. */
export function releaseVelocity(samples: readonly DragSample[]): { x: number; y: number } {
  const last = samples.at(-1);
  if (!last) return { x: 0, y: 0 };
  const first = samples.find((sample) => last.at - sample.at <= VELOCITY_WINDOW_MS) ?? last;
  const seconds = (last.at - first.at) / 1000;
  if (seconds <= 0) return { x: 0, y: 0 };
  return { x: (last.x - first.x) / seconds, y: (last.y - first.y) / seconds };
}

/** Where a thrown orb comes to rest: momentum projected forward, then kept on a display. */
export function throwTarget(
  from: { x: number; y: number },
  velocity: { x: number; y: number },
  workAreas: readonly BubbleBounds[],
): { x: number; y: number } {
  const project = (speed: number) => ((speed / 1000) * DECELERATION) / (1 - DECELERATION);
  const resting = { x: from.x + project(velocity.x), y: from.y + project(velocity.y) };
  const size = BUBBLE_LIMITS.orbSize;
  const area = workAreaFor({ ...resting, width: size, height: size }, workAreas);
  return {
    x: Math.round(Math.min(Math.max(resting.x, area.x), area.x + area.width - size)),
    y: Math.round(Math.min(Math.max(resting.y, area.y), area.y + area.height - size)),
  };
}
