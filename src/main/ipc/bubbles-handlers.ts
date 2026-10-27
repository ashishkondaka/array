// Floating agent bubbles (OpenBot Bubbles fork). Any app window may open, close, expand or hide a
// bubble. Only a bubble window may drag, and only its own orb: every window has one origin, so the
// sender id decides which bubble a drag moves, never the payload.

import type { IpcMainInvokeEvent } from "electron";
import type { BubbleWindowManager } from "../bubbles/bubble-window-manager";
import { parseBubbleAgentId, parseBubbleDragPoint, parseBubbleExpanded, parseBubbleHidden } from "./bubbles-inputs";
import { authorizedHandler, eventHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface BubblesIpcDependencies {
  bubbles: BubbleWindowManager;
}

export function requireBubbleSender(bubbles: Pick<BubbleWindowManager, "agentForSender">, senderId: number): string {
  const agentId = bubbles.agentForSender(senderId);
  if (!agentId) throw new Error("Rejected bubble IPC request outside a bubble window.");
  return agentId;
}

export function bubblesIpcHandlers({ bubbles }: BubblesIpcDependencies): Pick<IpcGroupHandlers, "bubbles"> {
  const fromBubble = (event: IpcMainInvokeEvent) => {
    requireBubbleSender(bubbles, event.sender.id);
  };
  return {
    bubbles: {
      list: handler(() => bubbles.snapshot()),
      open: payloadHandler(parseBubbleAgentId, (agentId) => bubbles.open(agentId)),
      close: payloadHandler(parseBubbleAgentId, (agentId) => bubbles.close(agentId)),
      setExpanded: payloadHandler(parseBubbleExpanded, ({ agentId, expanded }) =>
        bubbles.setExpanded(agentId, expanded),
      ),
      focusMain: payloadHandler(parseBubbleAgentId, (agentId) => bubbles.focusMain(agentId)),
      setHidden: payloadHandler(parseBubbleHidden, (hidden) => bubbles.setHidden(hidden)),
      dragTo: authorizedHandler(fromBubble, parseBubbleDragPoint, (event, point) =>
        bubbles.dragTo(requireBubbleSender(bubbles, event.sender.id), point),
      ),
      dragEnd: eventHandler((event) => bubbles.dragEnd(requireBubbleSender(bubbles, event.sender.id))),
    },
  };
}
