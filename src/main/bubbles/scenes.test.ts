// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import type { DesktopWindow } from "./attach-target";
import { detectScene, gazeToward, isFullScreen, NO_SCENE, nextSceneState, sameStage, theaterSeats } from "./scenes";

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

describe("nextSceneState", () => {
  const show = { kind: "theater" as const, window: window(7, "TV") };

  it("starts a show after two ticks of the same stage, and ends it after two ticks without", () => {
    const one = nextSceneState(NO_SCENE, show);
    expect(one.current).toBeNull();
    const two = nextSceneState(one, show);
    expect(two.current?.window.windowId).toBe(7);
    const gone1 = nextSceneState(two, null);
    expect(gone1.current?.window.windowId).toBe(7);
    const gone2 = nextSceneState(gone1, null);
    expect(gone2.current).toBeNull();
  });

  it("keeps the show when the stage moves, and does not flicker on a glance elsewhere", () => {
    const on = nextSceneState(nextSceneState(NO_SCENE, show), show);
    const moved = {
      kind: "theater" as const,
      window: window(7, "TV", { bounds: { x: 300, y: 200, width: 900, height: 560 } }),
    };
    expect(nextSceneState(on, moved).current?.window.bounds.x).toBe(300);
    const glance = nextSceneState(on, { kind: "theater", window: window(9, "VLC") });
    expect(glance.current?.window.windowId).toBe(7);
    expect(nextSceneState(glance, show).current?.window.windowId).toBe(7);
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
