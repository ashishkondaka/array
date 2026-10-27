// Builds drag-to-attach from the application services: the Computer Use driver for the window list
// and the embedded browser for the "Open in OpenBot browser" handoff.

import type { ApplicationServices } from "../application-services";
import { CuaDriverDaemonClient } from "../cua-driver-daemon-client";
import { computerUseDesktopRect } from "../main-window";
import { BubbleAttachController } from "./bubble-attach";
import type { BubbleWindowManager } from "./bubble-window-manager";

export type { BubbleAttachController };

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
  });
}
