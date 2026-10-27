// The bubble windows that are open now. `main-window.ts` adds them to its chat windows through this
// module, so a bubble gets what a chat window gets (agent events, sign-in state, language, focus)
// with one hook and without a dependency on the manager.

import type { BrowserWindow } from "electron";

let source: () => BrowserWindow[] = () => [];

export function setBubbleWindowSource(read: () => BrowserWindow[]): void {
  source = read;
}

export function bubbleWindows(): BrowserWindow[] {
  return source().filter((window) => !window.isDestroyed());
}
