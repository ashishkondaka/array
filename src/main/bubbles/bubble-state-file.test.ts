// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { decodeBubblesFile } from "./bubble-state-file";

/** The fields a test sets, valid or not: the decoder is what checks them. */
interface BubbleFields {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  expanded?: unknown;
  attached?: unknown;
  extra?: unknown;
}

const bubble = (agentId: string, fields: BubbleFields = {}) => ({
  agentId,
  x: 100,
  y: 200,
  width: BUBBLE_LIMITS.expandedWidth,
  height: BUBBLE_LIMITS.expandedHeight,
  expanded: false,
  attached: null,
  ...fields,
});

const attached = {
  kind: "window",
  appName: "TextEdit",
  bundleId: "com.apple.TextEdit",
  title: "notes.txt",
  pid: 4242,
  windowId: 77,
  bounds: { x: 10, y: 20, width: 800, height: 600 },
  attachedAt: 1_700_000_000_000,
  browserUrl: null,
};

describe("the saved bubbles file", () => {
  it("reads a valid file and drops unknown keys", () => {
    const decoded = decodeBubblesFile({
      version: 1,
      hidden: true,
      bubbles: [bubble("agent-a", { extra: "dropped", attached: { ...attached, extra: 1 } })],
      future: "dropped",
    });
    expect(decoded).toEqual({ hidden: true, bubbles: [bubble("agent-a", { attached })] });
  });

  it("reads another version, or a shape that is not a file, as the default", () => {
    expect(decodeBubblesFile({ version: 2, bubbles: [] })).toBeNull();
    expect(decodeBubblesFile(null)).toBeNull();
    expect(decodeBubblesFile([])).toBeNull();
    expect(decodeBubblesFile({ version: 1, bubbles: "x" })).toBeNull();
  });

  it("drops a damaged entry and keeps the others", () => {
    const decoded = decodeBubblesFile({
      version: 1,
      bubbles: [
        bubble("agent-a"),
        bubble("agent-b", { x: "far" }),
        bubble("agent-c", { width: 10 }),
        bubble("agent-d", { attached: { ...attached, pid: 0 } }),
        bubble("", {}),
        bubble("agent-e", { y: BUBBLE_LIMITS.coordinate + 1 }),
        bubble("agent-f", { expanded: "yes" }),
        bubble("agent-g"),
      ],
    });
    expect(decoded?.bubbles.map((entry) => entry.agentId)).toEqual(["agent-a", "agent-g"]);
    expect(decoded?.hidden).toBe(false);
  });

  it("keeps one bubble for each agent and no more than the limit", () => {
    const many = Array.from({ length: BUBBLE_LIMITS.bubbles + 3 }, (_, index) => bubble(`agent-${index}`));
    const decoded = decodeBubblesFile({ version: 1, bubbles: [bubble("agent-0", { x: 5 }), ...many] });
    expect(decoded?.bubbles).toHaveLength(BUBBLE_LIMITS.bubbles);
    expect(decoded?.bubbles[0]?.x).toBe(5);
    expect(new Set(decoded?.bubbles.map((entry) => entry.agentId)).size).toBe(BUBBLE_LIMITS.bubbles);
  });

  it("treats a hidden flag that is not a boolean as shown", () => {
    expect(decodeBubblesFile({ version: 1, hidden: "yes", bubbles: [] })).toEqual({ hidden: false, bubbles: [] });
  });
});
