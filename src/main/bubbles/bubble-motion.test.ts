// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { nudgeTarget, type SpringState, springSettled, springStep } from "./bubble-motion";

const primary = { x: 0, y: 25, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 1920, height: 1080 };

describe("nudge target", () => {
  it("hovers over the top centre of the front window", () => {
    const window = { x: 200, y: 300, width: 800, height: 500 };
    expect(nudgeTarget(window, { x: 0, y: 0 }, [primary])).toEqual({
      x: 200 + 400 - BUBBLE_LIMITS.orbSize / 2,
      y: 300 - BUBBLE_LIMITS.orbSize / 2 - 12,
    });
  });

  it("stays on the display when the window is at its top", () => {
    const maximized = { x: 0, y: 25, width: 1440, height: 875 };
    expect(nudgeTarget(maximized, { x: 0, y: 0 }, [primary]).y).toBe(25);
  });

  it("falls back to the top centre of the pointer's display", () => {
    expect(nudgeTarget(null, { x: 2000, y: 500 }, [primary, right])).toEqual({
      x: 1440 + 960 - BUBBLE_LIMITS.orbSize / 2,
      y: 12,
    });
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
