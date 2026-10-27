// @vitest-environment node

import { BUBBLE_LIMITS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { appMatch, appWindow, type DesktopWindow, findApp, readDesktopApps } from "./attach-target";
import { dockStop } from "./bubble-layout";

const OWN_PID = 100;

const window = (windowId: number, appName: string, fields: Partial<DesktopWindow> = {}): DesktopWindow => ({
  windowId,
  pid: 4000 + windowId,
  appName,
  title: `${appName} ${windowId}`,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  zIndex: windowId,
  onScreen: true,
  onCurrentSpace: true,
  ...fields,
});

describe("appMatch", () => {
  it("matches the name as typed, the shortened name and the lengthened one", () => {
    expect(appMatch("Mail", "mail")).toBe("exact");
    expect(appMatch("Mail.app", "Mail")).toBe("exact");
    expect(appMatch("Google Chrome", "Chrome")).toBe("partial");
    expect(appMatch("Mail", "Apple Mail")).toBe("partial");
    expect(appMatch("Calendar", "Mail")).toBeNull();
    expect(appMatch("", "Mail")).toBeNull();
  });
});

describe("appWindow", () => {
  it("takes the frontmost usable window of the app, exact names first", () => {
    const windows = [
      window(1, "Mail"),
      window(2, "Mail"),
      window(3, "Mailspring"),
      window(4, "Mail", { bounds: { x: 0, y: 0, width: 80, height: 40 } }),
      window(5, "Mail", { onScreen: false }),
    ];
    expect(appWindow(windows, "mail", OWN_PID, new Set())?.windowId).toBe(2);
    expect(appWindow(windows, "Mailspring", OWN_PID, new Set())?.windowId).toBe(3);
  });

  it("never goes to OpenBot or to a bubble", () => {
    const windows = [window(1, "Array", { pid: OWN_PID }), window(2, "Array")];
    expect(appWindow(windows, "Array", OWN_PID, new Set([2]))).toBeNull();
  });

  it("is null for an app with no window", () => {
    expect(appWindow([window(1, "Mail")], "Calendar", OWN_PID, new Set())).toBeNull();
  });
});

describe("readDesktopApps and findApp", () => {
  const payload = {
    apps: [
      {
        name: "Mail",
        bundle_id: "com.apple.mail",
        running: false,
        pid: 0,
        launch_path: "/System/Applications/Mail.app",
      },
      { name: "Calendar", bundle_id: "com.apple.iCal", running: true, pid: 512 },
      { bundle_id: "no.name" },
      "not a record",
    ],
  };

  it("reads the records it understands", () => {
    expect(readDesktopApps(payload)).toEqual([
      { name: "Mail", bundleId: "com.apple.mail", running: false, pid: 0, launchPath: "/System/Applications/Mail.app" },
      { name: "Calendar", bundleId: "com.apple.iCal", running: true, pid: 512, launchPath: null },
    ]);
    expect(readDesktopApps(null)).toEqual([]);
  });

  it("finds an app by name or bundle id, a running one first", () => {
    const apps = readDesktopApps(payload);
    expect(findApp(apps, "mail")?.bundleId).toBe("com.apple.mail");
    expect(findApp(apps, "com.apple.ical")?.name).toBe("Calendar");
    expect(findApp(apps, "Photos")).toBeNull();
    const two = [...apps, { name: "Mail", bundleId: "com.apple.mail", running: true, pid: 77, launchPath: null }];
    expect(findApp(two, "Mail")?.pid).toBe(77);
  });
});

describe("dockStop", () => {
  const size = BUBBLE_LIMITS.orbSize;

  it("stops just above a Dock at the bottom, at its middle", () => {
    const stop = dockStop({
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      workArea: { x: 0, y: 38, width: 1512, height: 868 },
    });
    expect(stop).toEqual({ x: 756 - size / 2, y: 38 + 868 - size - 4 });
  });

  it("stops beside a Dock on the left or the right", () => {
    expect(
      dockStop({
        bounds: { x: 0, y: 0, width: 1512, height: 982 },
        workArea: { x: 80, y: 38, width: 1432, height: 944 },
      }),
    ).toEqual({ x: 84, y: 491 - size / 2 });
    expect(
      dockStop({
        bounds: { x: 0, y: 0, width: 1512, height: 982 },
        workArea: { x: 0, y: 38, width: 1432, height: 944 },
      }),
    ).toEqual({ x: 1432 - size - 4, y: 491 - size / 2 });
  });

  it("is null when only the menu bar is left out, or the Dock is hidden", () => {
    expect(
      dockStop({
        bounds: { x: 0, y: 0, width: 1512, height: 982 },
        workArea: { x: 0, y: 38, width: 1512, height: 944 },
      }),
    ).toBeNull();
    expect(
      dockStop({
        bounds: { x: 0, y: 0, width: 1512, height: 982 },
        workArea: { x: 0, y: 0, width: 1512, height: 982 },
      }),
    ).toBeNull();
  });
});
