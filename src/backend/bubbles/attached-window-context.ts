// The window a bubble is attached to, told to its agent at the start of each turn (OpenBot Bubbles
// fork). Main owns the attachment and sets the source; the drain scheduler asks for the block.

import type { AttachedSurface } from "@openbot/contracts/ipc";

export const ATTACHED_WINDOW_BLOCK_START = "<openbot_attached_window>";
const ATTACHED_WINDOW_BLOCK_END = "</openbot_attached_window>";

let source: (agentId: string) => AttachedSurface | null = () => null;

export function setAttachedWindowSource(read: (agentId: string) => AttachedSurface | null): void {
  source = read;
}

/**
 * What the agent reads about its attached window. It names the exact pid and window id, so every
 * Computer Use call can be scoped to that window, and it asks for the window's own state first,
 * which carries the screenshot. Nothing here grants anything: each action still goes through the
 * agent's approval policy.
 */
export function attachedWindowBlock(surface: AttachedSurface): string {
  const { bounds } = surface;
  const lines = [
    ATTACHED_WINDOW_BLOCK_START,
    "The user attached you to a window on their screen. Treat it as the subject of their messages.",
    `- App: ${surface.appName}${surface.bundleId ? ` (${surface.bundleId})` : ""}`,
    `- Window title: ${surface.title || "(none)"}`,
    `- pid ${surface.pid}, window_id ${surface.windowId}`,
    `- Bounds in desktop points: x ${bounds.x}, y ${bounds.y}, ${bounds.width} × ${bounds.height}`,
    "A screenshot of this window is available. Before you answer about it or act in it, call the",
    `computer_use tool get_window_state with pid ${surface.pid} and window_id ${surface.windowId}; it returns`,
    "the screenshot and the accessibility tree. Act only in this window, with Computer Use tools",
    "scoped to this pid and window_id. Do not move to other windows or apps unless the user asks.",
  ];
  if (surface.browserUrl) {
    lines.push(
      `The window is a web browser showing ${surface.browserUrl}. For page work, prefer the OpenBot`,
      "browser tools (open that address there): they read the page structurally and keep secure input",
      "safe. Computer Use on an external browser works from screenshots and is slower.",
    );
  }
  lines.push(ATTACHED_WINDOW_BLOCK_END);
  return lines.join("\n");
}

/** The turn input with the attached-window block first, as a block of its own, or unchanged. */
export function withAttachedWindow<Item extends { type: string }>(
  agentId: string,
  input: Item[],
): (Item | { type: "text"; text: string })[] {
  const surface = source(agentId);
  return surface ? [{ type: "text", text: attachedWindowBlock(surface) }, ...input] : input;
}
