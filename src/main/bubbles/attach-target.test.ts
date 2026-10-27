// @vitest-environment node

import { type AttachedSurface, BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  attachedSurface,
  dropOutcome,
  dropTarget,
  followAttachment,
  readBrowserAddress,
  readDesktopWindows,
  snappedPosition,
} from "./attach-target";

const OWN_PID = 100;

const record = (windowId: number, fields: { pid?: number; app?: string; z?: number | null; bounds?: object } = {}) => ({
  window_id: windowId,
  pid: fields.pid ?? 4242,
  app_name: fields.app ?? "TextEdit",
  title: `Window ${windowId}`,
  bounds: fields.bounds ?? { x: 0, y: 0, width: 800, height: 600 },
  z_index: fields.z === undefined ? windowId : fields.z,
  is_on_screen: true,
  on_current_space: true,
});

const windows = (...records: unknown[]) => readDesktopWindows({ windows: records, current_space_id: 1 });

describe("drop targets", () => {
  it("parses the driver's window list and skips broken records", () => {
    const parsed = windows(record(1), { window_id: "x" }, { window_id: 2, pid: 3, bounds: { x: 1 } }, null);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ windowId: 1, pid: 4242, appName: "TextEdit", zIndex: 1 });
    expect(readDesktopWindows(null)).toEqual([]);
  });

  it("picks the frontmost window under the pointer", () => {
    const list = windows(record(1, { z: 1 }), record(2, { z: 5, app: "Notes" }), record(3, { z: 3 }));
    expect(dropTarget(list, { x: 10, y: 10 }, OWN_PID, new Set())?.windowId).toBe(2);
  });

  it("looks through the dragged bubble, but not through the main window", () => {
    const bubble = record(9, { pid: OWN_PID, z: 9, bounds: { x: 0, y: 0, width: 200, height: 200 } });
    const main = record(8, { pid: OWN_PID, z: 8 });
    expect(dropTarget(windows(record(1), bubble), { x: 10, y: 10 }, OWN_PID, new Set([9]))?.windowId).toBe(1);
    expect(dropTarget(windows(record(1), main, bubble), { x: 10, y: 10 }, OWN_PID, new Set([9]))).toBeNull();
  });

  it("skips small windows, the driver overlay, and windows away from the pointer", () => {
    const list = windows(
      record(1, { bounds: { x: 0, y: 0, width: 100, height: 600 } }),
      record(2, { app: "cua-driver", z: 50 }),
      record(3, { bounds: { x: 1000, y: 0, width: 800, height: 600 } }),
    );
    expect(dropTarget(list, { x: 10, y: 10 }, OWN_PID, new Set())).toBeNull();
  });
});

describe("attach and detach", () => {
  const [target] = windows(record(1));
  if (!target) throw new Error("The fixture window must parse.");
  const surface = (fields: Partial<AttachedSurface> = {}): AttachedSurface => ({
    ...attachedSurface(target, 1, null),
    ...fields,
  });

  it("snaps the orb into the window's top-right corner", () => {
    expect(snappedPosition({ x: 100, y: 50, width: 800, height: 600 })).toEqual({
      x: 100 + 800 - BUBBLE_LIMITS.attachedOrbWidth - 8,
      y: 58,
    });
  });

  it("attaches on a new window, keeps the same one, detaches off any window", () => {
    expect(dropOutcome({ attached: null }, target)).toEqual({ kind: "attach", window: target });
    expect(dropOutcome({ attached: surface() }, target)).toEqual({ kind: "stay-attached" });
    expect(dropOutcome({ attached: surface({ windowId: 7 }) }, target).kind).toBe("attach");
    expect(dropOutcome({ attached: surface() }, null)).toEqual({ kind: "detach" });
    expect(dropOutcome({ attached: null }, null)).toEqual({ kind: "none" });
  });

  it("follows a window that moves and detaches from one that closes", () => {
    expect(followAttachment(surface(), windows(record(1)))).toEqual({ kind: "same" });
    const moved = windows(record(1, { bounds: { x: 40, y: 40, width: 800, height: 600 } }));
    expect(followAttachment(surface(), moved)).toMatchObject({ kind: "moved", bounds: { x: 40, y: 40 } });
    expect(followAttachment(surface(), windows(record(2)))).toEqual({ kind: "gone" });
    expect(followAttachment(surface({ pid: 1 }), windows(record(1)))).toEqual({ kind: "gone" });
  });
});

describe("browser addresses", () => {
  const tree = (...elements: object[]) => ({ elements });

  it("reads the address field, with or without a scheme", () => {
    expect(
      readBrowserAddress(tree({ role: "AXTextField", label: "Address and search bar", value: "openbot.run/docs" })),
    ).toBe("https://openbot.run/docs");
    expect(readBrowserAddress(tree({ role: "AXComboBox", value: "http://localhost:3000/a?b=1" }))).toBe(
      "http://localhost:3000/a?b=1",
    );
  });

  it("returns null for anything that is not a web address", () => {
    expect(readBrowserAddress(tree({ role: "AXTextField", value: "search words here" }))).toBeNull();
    expect(readBrowserAddress(tree({ role: "AXTextField", value: "file:///etc/passwd" }))).toBeNull();
    expect(readBrowserAddress(tree({ role: "AXStaticText", label: "Title", value: "openbot.run" }))).toBeNull();
    expect(readBrowserAddress(null)).toBeNull();
  });
});
