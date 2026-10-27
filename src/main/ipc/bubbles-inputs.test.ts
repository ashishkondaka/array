// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { requireBubbleSender } from "./bubbles-handlers";
import { parseBubbleAgentId, parseBubbleDragPoint, parseBubbleExpanded, parseBubbleHidden } from "./bubbles-inputs";

describe("bubble payloads from the renderer", () => {
  it("accepts an agent id and rejects anything else", () => {
    expect(parseBubbleAgentId("agent-1")).toBe("agent-1");
    for (const value of ["", "   ", 7, null, undefined, {}, "x".repeat(129)]) {
      expect(() => parseBubbleAgentId(value)).toThrow();
    }
  });

  it("keeps only the known keys of an expand change", () => {
    expect(parseBubbleExpanded({ agentId: "agent-1", expanded: true, extra: "dropped" })).toEqual({
      agentId: "agent-1",
      expanded: true,
    });
    expect(() => parseBubbleExpanded({ agentId: "agent-1", expanded: "true" })).toThrow();
    expect(() => parseBubbleExpanded({ expanded: true })).toThrow();
    expect(() => parseBubbleExpanded(null)).toThrow();
  });

  it("accepts a boolean for hidden only", () => {
    expect(parseBubbleHidden(false)).toBe(false);
    expect(() => parseBubbleHidden("false")).toThrow();
  });

  it("accepts integer drag points within the desktop bounds", () => {
    expect(parseBubbleDragPoint({ x: -1200, y: 40, extra: 1 })).toEqual({ x: -1200, y: 40 });
    for (const value of [
      { x: 1.5, y: 0 },
      { x: 0 },
      { x: BUBBLE_LIMITS.coordinate + 1, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: "1", y: "2" },
      null,
    ]) {
      expect(() => parseBubbleDragPoint(value)).toThrow();
    }
  });
});

describe("bubble sender checks", () => {
  const bubbles = { agentForSender: (id: number) => (id === 12 ? "agent-1" : null) };

  it("names the bubble that sent a drag, from the sender and not the payload", () => {
    expect(requireBubbleSender(bubbles, 12)).toBe("agent-1");
  });

  it("rejects a drag from a window that is not a bubble", () => {
    expect(() => requireBubbleSender(bubbles, 3)).toThrow("outside a bubble window");
  });
});
