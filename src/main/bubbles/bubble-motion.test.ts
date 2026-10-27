// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { nudgeTarget, type SpringState, springSettled, springStep } from "./bubble-motion";

const primary = { x: 0, y: 25, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 1920, height: 1080 };

describe("nudge target", () => {
  it("stops beside the pointer, on the pointer's display", () => {
    const target = nudgeTarget({ x: 2000, y: 500 }, [primary, right]);
    expect(target.x).toBeLessThan(2000);
    expect(target.x).toBeGreaterThanOrEqual(1440);
    expect(Math.abs(target.y - 500)).toBeLessThanOrEqual(BUBBLE_LIMITS.orbSize);
  });

  it("stays inside the work area at the edges", () => {
    expect(nudgeTarget({ x: 5, y: 30 }, [primary])).toEqual({ x: 29, y: 25 });
    const corner = nudgeTarget({ x: 1439, y: 899 }, [primary]);
    expect(corner.x + BUBBLE_LIMITS.orbSize).toBeLessThanOrEqual(1440);
    expect(corner.y + BUBBLE_LIMITS.orbSize).toBeLessThanOrEqual(900);
  });
});

describe("the nudge spring", () => {
  it("settles on the target without overshoot", () => {
    let state: SpringState = { position: 0, velocity: 0 };
    let peak = 0;
    for (let frame = 0; frame < 120 && !springSettled(state, 500); frame += 1) {
      state = springStep(state, 500, 1 / 60);
      peak = Math.max(peak, state.position);
    }
    expect(springSettled(state, 500)).toBe(true);
    expect(peak).toBeLessThanOrEqual(500.5);
  });

  it("keeps its speed when the target changes mid-flight", () => {
    const moving = springStep({ position: 0, velocity: 0 }, 500, 0.1);
    const redirected = springStep(moving, 0, 1 / 60);
    expect(moving.velocity).toBeGreaterThan(0);
    expect(redirected.position).toBeGreaterThan(moving.position);
  });
});
