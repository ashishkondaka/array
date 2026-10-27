// Builds the fork's service-backed parts from the application services: drag-to-attach (the Computer
// Use driver for the window list, the embedded browser for the handoff) and the local analyst seed.

import { resolve } from "node:path";
import { app } from "electron";
import type { ApplicationServices } from "../application-services";
import { CuaDriverDaemonClient } from "../cua-driver-daemon-client";
import { computerUseDesktopPoint, computerUseDesktopRect } from "../main-window";
import { probeModels } from "../model-server-probe";
import { AppleModelServer, appleModelBinaryPath } from "./apple-model";
import { BubbleAttachController } from "./bubble-attach";
import type { BubbleWindowManager } from "./bubble-window-manager";

import { LocalAnalystSeed } from "./local-analyst";
import { ThinkingCapabilities } from "./thinking-capabilities";

export type { AppleModelServer, BubbleAttachController, LocalAnalystSeed, ThinkingCapabilities };

/** The Apple on-device model: its server, its endpoint and its seed agent (macOS 26 and later). */
export function createAppleModelServer(
  services: Pick<ApplicationServices, "customProviderChanges" | "service">,
): AppleModelServer {
  const { customProviderChanges, service } = services;
  return new AppleModelServer({
    userDataPath: app.getPath("userData"),
    binaryPath: appleModelBinaryPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      // The bundled main runs from `out/main`, two levels below the checkout, as the driver lookup assumes.
      sourceRoot: resolve(__dirname, "../.."),
      platform: process.platform,
      architecture: process.arch,
    }),
    savedEndpoints: () => customProviderChanges.list(),
    saveEndpoint: (input) => customProviderChanges.save(input),
    updateEndpoint: (input) => customProviderChanges.update(input),
    catalogue: () => service.listModels(),
    createAgent: (input) => service.createAgent(input),
  });
}

/** Reads, from the local servers, which custom models cannot think, so no thinking level reaches them. */
export function createThinkingCapabilities(
  services: Pick<ApplicationServices, "customProviderChanges">,
): ThinkingCapabilities {
  return new ThinkingCapabilities({ providers: () => services.customProviderChanges.list(), fetch });
}

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
