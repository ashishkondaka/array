import type { CentralAuthUser } from "@openbot/contracts/ipc";
import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { BubbleOrb } from "@openbot/ui/features/bubbles/BubbleOrb";
import { BubblePanelHeader } from "@openbot/ui/features/bubbles/BubblePanelHeader";
import type { BubbleStatus } from "@openbot/ui/features/bubbles/bubble-status";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import { usePlatform } from "../../platform";
import { useTurns } from "../../turns";
import { WorkspaceOverlays } from "../../WorkspaceOverlays";
import { attentionByAgent } from "../agents/agent-runtime-snapshot";
import { agentThreadAttention } from "../agents/agent-thread-attention";
import { useAgents } from "../agents/agents-context";
import { ConnectorsProvider } from "../connectors/connectors-context";
import { useConversation } from "../conversation/conversation-context";
import { WorkspaceConversation } from "../conversation/WorkspaceConversation";
import { attachedLabel } from "./bubble-attachment";
import { createBubbleDrag } from "./bubble-drag";
import { useBubbles } from "./bubbles-context";

/**
 * A bubble window: the orb, or the compact chat of its agent. The chat is the same
 * `WorkspaceConversation` the main window shows, in chat-window mode, so streaming, attachments and
 * every attention card (approvals, questions, browser takeover, secure input) work here unchanged and
 * answer through the same IPC.
 */
export function BubbleShell(props: { account: () => CentralAuthUser; agentId: string }) {
  const bubbles = useBubbles();
  const platform = usePlatform();
  const { agentList } = useAgents();
  const { activeTurns, queues, failedTurns, usageLimits, pendingPrompts, pendingApprovals, approvals } = useTurns();
  const { unreadReplies, recentReplies } = useConversation();
  const agent = createMemo(() => agentList().find((candidate) => candidate.id === props.agentId) ?? null);
  const state = () => bubbles.bubbleOf(props.agentId);
  const expanded = () => state()?.expanded ?? false;
  const label = () => attachedLabel(state()?.attached ?? null);

  // The same derivations as the sidebar row, so the orb and the row never disagree.
  const sidebarState = createMemo(
    () =>
      computeSidebarAgentStates({
        agentIds: [props.agentId],
        activeTurns: activeTurns(),
        queues: queues(),
        unreadReplies: unreadReplies(),
        recentReplies: recentReplies(),
        ...agentThreadAttention({ agents: agentList(), pendingPrompts: pendingPrompts(), approvals: approvals() }),
        failedTurns: failedTurns(),
        usageLimits: usageLimits(),
      })[props.agentId],
  );
  const status = (): BubbleStatus => {
    switch (sidebarState()?.kind) {
      case "waiting":
        return "attention";
      case "working":
      case "routine":
        return "working";
      case "unread":
      case "responded":
        return "unread";
      default:
        return "idle";
    }
  };
  const mood = () =>
    computeAgentAvatarMoods({
      agentIds: [props.agentId],
      activeTurns: activeTurns(),
      queues: queues(),
      failedTurns: failedTurns(),
      pendingPrompts: attentionByAgent(pendingPrompts(), agentList()),
      pendingApprovals: pendingApprovals(),
      recentReplies: recentReplies(),
    })[props.agentId] ?? "idle";

  const drag = createBubbleDrag({
    moveTo: bubbles.dragTo,
    end: bubbles.dragEnd,
    click: () => bubbles.setExpanded(props.agentId, true),
  });

  // The window is transparent around the orb and the panel card. A collapsed orb hides notifications.
  createEffect(expanded, (open) => {
    document.documentElement.dataset.bubbleWindow = open ? "expanded" : "collapsed";
  });
  onCleanup(() => {
    delete document.documentElement.dataset.bubbleWindow;
  });

  return (
    <div class="bubble-window" data-platform={platform.appInfo()?.platform}>
      <Show when={agent()}>
        {(current) => (
          <Show
            when={expanded()}
            fallback={
              <BubbleOrb
                agent={current()}
                status={status()}
                mood={mood()}
                unreadCount={unreadReplies()[props.agentId] ?? 0}
                attachedLabel={label()}
                onPointerDown={drag.pointerDown}
                onPointerMove={drag.pointerMove}
                onPointerUp={drag.pointerUp}
                onClick={drag.click}
              />
            }
          >
            <ConnectorsProvider>
              <div class="bubble-panel">
                <BubblePanelHeader
                  agent={current()}
                  mood={mood()}
                  attachedLabel={label()}
                  onCollapse={() => bubbles.setExpanded(props.agentId, false)}
                  onOpenMain={() => bubbles.focusMain(props.agentId)}
                  onClose={() => bubbles.bringBack(props.agentId)}
                />
                <div class="bubble-panel-body">
                  <WorkspaceConversation account={props.account} />
                </div>
              </div>
              <WorkspaceOverlays account={props.account} />
            </ConnectorsProvider>
          </Show>
        )}
      </Show>
    </div>
  );
}
