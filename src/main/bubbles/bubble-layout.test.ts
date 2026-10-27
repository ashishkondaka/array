// @vitest-environment node

import { BUBBLE_LIMITS, type BubbleState } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { clampOrb, defaultOrbPosition, expandedBounds, separateOrb } from "./bubble-layout";

const primary = { x: 0, y: 25, width: 1440, height: 875 };
const right = { x: 1440, y: 0, width: 1920, height: 1080 };

const state = (fields: Partial<BubbleState> = {}): BubbleState => ({
  agentId: "agent",
  x: 100,
  y: 100,
  width: BUBBLE_LIMITS.expandedWidth,
  height: BUBBLE_LIMITS.expandedHeight,
  expanded: false,
  attached: null,
  ...fields,
});

describe("bubble layout", () => {
  it("keeps an orb on the display it is on", () => {
    expect(clampOrb(state({ x: 2000, y: 500 }), [primary, right])).toEqual({ x: 2000, y: 500 });
    expect(clampOrb(state({ x: 1380, y: 10 }), [primary, right])).toEqual({ x: 1440 - 72, y: 25 });
  });

  it("moves an orb from a disconnected display to the primary display", () => {
    expect(clampOrb(state({ x: 2500, y: 600 }), [primary])).toEqual({ x: 1440 - BUBBLE_LIMITS.orbSize, y: 600 });
    expect(clampOrb(state({ x: -5000, y: -5000 }), [primary])).toEqual({ x: 0, y: 25 });
  });

  it("opens the panel from the orb and shifts it only to fit", () => {
    expect(expandedBounds(state({ x: 100, y: 100 }), [primary])).toEqual({ x: 100, y: 100, width: 388, height: 572 });
    expect(expandedBounds(state({ x: 1360, y: 700 }), [primary])).toEqual({
      x: 1440 - 388,
      y: 25 + 875 - 572,
      width: 388,
      height: 572,
    });
  });

  it("places new orbs down the right edge without covering one", () => {
    const first = defaultOrbPosition([], [primary]);
    const second = defaultOrbPosition([first], [primary]);
    expect(first.x).toBe(1440 - BUBBLE_LIMITS.orbSize - 16);
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThanOrEqual(first.y + BUBBLE_LIMITS.orbSize);
  });

  it("offsets an orb snapped onto another one", () => {
    const moved = separateOrb({ x: 500, y: 300 }, [{ x: 500, y: 300 }]);
    expect(moved.x).toBe(500);
    expect(moved.y).toBeGreaterThanOrEqual(300 + BUBBLE_LIMITS.orbSize);
    expect(separateOrb({ x: 500, y: 300 }, [{ x: 900, y: 300 }])).toEqual({ x: 500, y: 300 });
  });
});
