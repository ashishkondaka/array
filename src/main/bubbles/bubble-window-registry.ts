// The bubble windows that are open now. `main-window.ts` adds them to its chat windows through this
// module, so a bubble gets what a chat window gets (agent events, sign-in state, language, focus)
// with one hook and without a dependency on the manager.

import type { BrowserWindow } from "electron";

let source: () => BrowserWindow[] = () => [];
let reveal: (agentId: string) => boolean = () => false;

export function setBubbleWindowSource(read: () => BrowserWindow[], revealBubble: (agentId: string) => boolean): void {
  source = read;
  reveal = revealBubble;
}

/**
 * Shows and expands the bubble of a local agent, if it has one. A notification click about that
 * agent then opens its bubble, not the main window, which may be hidden.
 */
export function revealBubble(agentId: string): boolean {
  return reveal(agentId);
}

export function bubbleWindows(): BrowserWindow[] {
  return source().filter((window) => !window.isDestroyed());
}
