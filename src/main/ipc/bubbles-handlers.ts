// Floating agent bubbles (OpenBot Bubbles fork). Any app window may open, close, expand or hide a
// bubble. Only a bubble window may drag, and only its own orb: every window has one origin, so the
// sender id decides which bubble a drag moves, never the payload.

import type { IpcMainInvokeEvent } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { BubbleAttachController } from "../bubbles/bubble-attach";
import type { BubbleWindowManager } from "../bubbles/bubble-window-manager";
import {
  parseBubbleAgentId,
  parseBubbleAttachOnRelease,
  parseBubbleCaller,
  parseBubbleCharacter,
  parseBubbleDragPoint,
  parseBubbleExpanded,
  parseBubbleHidden,
  parseBubbleNudges,
} from "./bubbles-inputs";
import { authorizedHandler, eventHandler, handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

export interface BubblesIpcDependencies {
  bubbles: BubbleWindowManager;
  /** Built with the services, after the handlers are registered. */
  attach: () => BubbleAttachController | null;
}

export function requireBubbleSender(bubbles: Pick<BubbleWindowManager, "agentForSender">, senderId: number): string {
  const agentId = bubbles.agentForSender(senderId);
  if (!agentId) throw new Error("Rejected bubble IPC request outside a bubble window.");
  return agentId;
}

export function bubblesIpcHandlers({ bubbles, attach }: BubblesIpcDependencies): Pick<IpcGroupHandlers, "bubbles"> {
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
      dragEnd: authorizedHandler(fromBubble, parseBubbleAttachOnRelease, (event, attach) =>
        bubbles.dragEnd(requireBubbleSender(bubbles, event.sender.id), attach),
      ),
      setCharacter: payloadHandler(parseBubbleCharacter, ({ agentId, character }) =>
        bubbles.setCharacter(agentId, character),
      ),
      setNudges: payloadHandler(parseBubbleNudges, (nudges) => bubbles.setNudges(nudges)),
      nudge: eventHandler((event) => bubbles.nudge(requireBubbleSender(bubbles, event.sender.id))),
      visit: authorizedHandler(fromBubble, parseBubbleCaller, (event, caller) =>
        bubbles.visit(requireBubbleSender(bubbles, event.sender.id), caller),
      ),
      detach: payloadHandler(parseBubbleAgentId, (agentId) => attach()?.detach(agentId)),
      openAttachedInBrowser: payloadHandler(parseBubbleAgentId, (agentId) => {
        const controller = attach();
        return controller ? runCauseEffect(controller.openInBrowser(agentId)) : undefined;
      }),
    },
  };
}
