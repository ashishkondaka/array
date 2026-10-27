import type { ChatWindowTarget } from "@openbot/contracts/ipc";
import { createSignal } from "solid-js";

/**
 * The agent of a bubble window (OpenBot Bubbles fork), or null in any other window. Main opens a
 * bubble at the app URL with `?window=bubble&server=<id>&agent=<id>`. The renderer runs it as a chat
 * window of that agent, and `WorkspaceShell` draws the bubble instead of the frame.
 */
export function readBubbleWindowTarget(search: string): ChatWindowTarget | null {
  const query = new URLSearchParams(search);
  const serverId = query.get("server");
  const agentId = query.get("agent");
  if (query.get("window") !== "bubble" || !serverId || !agentId) return null;
  return { serverId, agentId };
}

/**
 * Whether this bubble's chat is out of sight: true while the bubble is an orb. Read state is per
 * window, and a focused orb would otherwise mark a reply read that nobody saw. `WindowPageProvider`
 * counts it as a covered conversation; `BubbleShell` updates it. Always false outside a bubble.
 */
const [bubbleChatHidden, setBubbleChatHidden] = createSignal(
  typeof location !== "undefined" && readBubbleWindowTarget(location.search) !== null,
);

export { bubbleChatHidden, setBubbleChatHidden };
