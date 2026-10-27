// Builds the fork's service-backed parts from the application services: drag-to-attach (the Computer
// Use driver for the window list, the embedded browser for the handoff) and the local analyst seed.

import { app } from "electron";
import type { ApplicationServices } from "../application-services";
import { CuaDriverDaemonClient } from "../cua-driver-daemon-client";
import { computerUseDesktopPoint, computerUseDesktopRect } from "../main-window";
import { probeModels } from "../model-server-probe";
import { BubbleAttachController } from "./bubble-attach";
import type { BubbleWindowManager } from "./bubble-window-manager";

import { LocalAnalystSeed } from "./local-analyst";

export type { BubbleAttachController, LocalAnalystSeed };

/** An action this recent counts as the agent working; after it, the orb goes back to its corner. */
const WORK_FRESH_MS = 2_500;

export function createBubbleAttach(
  services: Pick<ApplicationServices, "browser" | "cuaDriver">,
  bubbles: BubbleWindowManager,
): BubbleAttachController {
  const { browser, cuaDriver } = services;
  // A connection of its own: the rim's reads and these never wait on each other.
  const reads = new CuaDriverDaemonClient(() => (cuaDriver.mcpServerForProviders() ? cuaDriver.socketPath() : null));
  return new BubbleAttachController({
    bubbles,
    reads,
    driverReady: () => cuaDriver.mcpServerForProviders() !== null,
    driverState: () => cuaDriver.lastState,
    ownPid: process.pid,
    bubbleWindowIds: () => bubbles.driverWindowIds(),
    toDesktopRect: computerUseDesktopRect,
    // The tab belongs to the agent, so its browser tools, secure input and takeover apply.
    openInBrowser: (agentId, url) => browser.open(url, null, agentId, false),
    reportIssue: (agentId, issue) => bubbles.reportAttachIssue(agentId, issue),
    observedWork: () => {
      const action = cuaDriver.lastAction(WORK_FRESH_MS);
      if (!action) return null;
      const pointer = cuaDriver.lastPointer(WORK_FRESH_MS);
      return {
        pid: action.pid,
        windowId: action.windowId,
        point: pointer ? computerUseDesktopPoint(pointer) : null,
      };
    },
  });
}

export function createLocalAnalystSeed(
  services: Pick<ApplicationServices, "customProviders" | "service">,
): LocalAnalystSeed {
  const { customProviders, service } = services;
  return new LocalAnalystSeed({
    userDataPath: app.getPath("userData"),
    probe: (baseUrl, timeoutMs) => probeModels({ baseUrl, apiKey: null, headers: [] }, timeoutMs),
    savedEndpoints: () => customProviders.list(),
    saveEndpoint: (input) => customProviders.save(input),
    catalogue: () => service.listModels(),
    createAgent: (input) => service.createAgent(input),
  });
}
