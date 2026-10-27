import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** The bridge calls of the bubbles domain. Nothing else in the renderer reads `window.openbot.bubbles`. */
export interface BubblesPort {
  bubbles: OpenBotDesktopApi["bubbles"];
  /** The attach notice opens the macOS permission pane that Computer Use needs. */
  computerUse: Pick<OpenBotDesktopApi["computerUse"], "openPermissionPane">;
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function bubblesPort(): BubblesPort {
  return window.openbot;
}
