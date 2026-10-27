// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { DesktopWindow } from "./attach-target";
import { detectScene, gazeToward, isFullScreen, sameStage, theaterSeats } from "./scenes";

const DISPLAY = { x: 0, y: 0, width: 1512, height: 982 };
const WORK = { x: 0, y: 38, width: 1512, height: 868 };

const window = (windowId: number, appName: string, fields: Partial<DesktopWindow> = {}): DesktopWindow => ({
  windowId,
  pid: 4000 + windowId,
  appName,
  title: `${appName} window`,
  bounds: { x: 200, y: 120, width: 900, height: 560 },
  zIndex: windowId,
  onScreen: true,
  onCurrentSpace: true,
  ...fields,
});

describe("detectScene", () => {
  it("is a theater for a player in front, a video site in a browser, or a full-screen window", () => {
    expect(detectScene([window(1, "Safari"), window(2, "QuickTime Player")], 100, new Set(), [DISPLAY])?.kind).toBe(
      "theater",
    );
    expect(
      detectScene([window(1, "Safari", { title: "Keynote — YouTube" })], 100, new Set(), [DISPLAY])?.window.windowId,
    ).toBe(1);
    expect(detectScene([window(1, "Keynote", { bounds: DISPLAY })], 100, new Set(), [DISPLAY])?.kind).toBe("theater");
  });

  it("is nothing for ordinary work, a video behind the front window, or OpenBot itself", () => {
    expect(detectScene([window(1, "QuickTime Player"), window(2, "Terminal")], 100, new Set(), [DISPLAY])).toBeNull();
    expect(detectScene([window(1, "Safari", { title: "Docs — Google" })], 100, new Set(), [DISPLAY])).toBeNull();
    expect(detectScene([window(1, "Array", { pid: 100, bounds: DISPLAY })], 100, new Set(), [DISPLAY])).toBeNull();
    expect(detectScene([window(1, "Array", { bounds: DISPLAY })], 100, new Set([1]), [DISPLAY])).toBeNull();
  });

  it("knows a full-screen window", () => {
    expect(isFullScreen(window(1, "TV", { bounds: { ...DISPLAY, width: 1511 } }), [DISPLAY])).toBe(true);
    expect(isFullScreen(window(1, "TV"), [DISPLAY])).toBe(false);
  });
});

describe("theaterSeats", () => {
  const size = BUBBLE_LIMITS.orbSize;

  it("seats a row centred under the stage", () => {
    const [first, second, third] = theaterSeats({ x: 200, y: 120, width: 900, height: 560 }, 3, WORK);
    expect(first && second && third).toBeTruthy();
    expect([first, second, third].every((seat) => seat?.y === 120 + 560 + 12)).toBe(true);
    const centre = ((first?.x ?? 0) + (third?.x ?? 0) + size) / 2;
    expect(Math.abs(centre - 650)).toBeLessThanOrEqual(1);
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBe(size + 12);
  });

  it("moves the row above a stage at the bottom, and inside a full-screen stage", () => {
    const [above] = theaterSeats({ x: 200, y: 400, width: 900, height: 500 }, 2, WORK);
    expect(above?.y).toBe(400 - 12 - size);
    const [inside] = theaterSeats(DISPLAY, 2, WORK);
    expect(inside?.y).toBe(WORK.y + WORK.height - size - 12);
  });

  it("keeps the row inside the work area and gives no seats for nobody", () => {
    const seats = theaterSeats({ x: -400, y: 120, width: 300, height: 200 }, 2, WORK);
    expect(seats.every((seat) => seat.x >= 12)).toBe(true);
    expect(theaterSeats(DISPLAY, 0, WORK)).toEqual([]);
  });
});

describe("gazeToward and sameStage", () => {
  it("points the eyes from the seat to the stage's centre", () => {
    const gaze = gazeToward({ x: 614, y: 692 }, { x: 200, y: 120, width: 900, height: 560 });
    expect(gaze.dx).toBe(0);
    expect(gaze.dy).toBe(-1);
    expect(gazeToward({ x: 0, y: 0 }, { x: 0, y: 0, width: 72, height: 72 })).toEqual({ dx: 0, dy: 0 });
  });

  it("tells one show from another by its window", () => {
    const a = { kind: "theater" as const, window: window(1, "TV") };
    expect(sameStage(a, { kind: "theater", window: window(1, "TV", { title: "moved" }) })).toBe(true);
    expect(sameStage(a, { kind: "theater", window: window(2, "TV") })).toBe(false);
    expect(sameStage(null, null)).toBe(true);
    expect(sameStage(a, null)).toBe(false);
  });
});
