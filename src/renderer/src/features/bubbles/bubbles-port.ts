import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** The bridge calls of the bubbles domain. Nothing else in the renderer reads `window.openbot.bubbles`. */
export type BubblesPort = OpenBotDesktopApi["bubbles"];

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function bubblesPort(): BubblesPort {
  return window.openbot.bubbles;
}
