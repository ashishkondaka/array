import type { BubbleAttachIssue, CentralAuthUser } from "@openbot/contracts/ipc";
import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { BubbleNotice } from "@openbot/ui/features/bubbles/BubbleNotice";
import { BubbleOrb, type BubbleOrbMotion } from "@openbot/ui/features/bubbles/BubbleOrb";
import { BubblePanelHeader } from "@openbot/ui/features/bubbles/BubblePanelHeader";
import { bubbleCharacter } from "@openbot/ui/features/bubbles/bubble-characters";
import type { BubbleStatus } from "@openbot/ui/features/bubbles/bubble-status";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { useText } from "@openbot/ui/text";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, onCleanup, onSettled, Show } from "solid-js";
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

/** A resting orb hops now and then, at a random moment, so a desktop of orbs never moves in step. */
const HOP_DELAY_MS = { min: 25_000, max: 55_000 };
const HOP_MS = 1_000;
/** As long as main keeps the orb beside the pointer, and a little more. */
const NUDGE_MS = 3_800;

const ISSUE_TEXT = {
  "permission-screen-recording": "bubbles.issueScreenRecording",
  "permission-accessibility": "bubbles.issueAccessibility",
  "driver-unavailable": "bubbles.issueDriver",
  "unsupported-platform": "bubbles.issueUnsupported",
} as const satisfies Record<BubbleAttachIssue, string>;

/**
 * A bubble window: the orb, or the compact chat of its agent. The chat is the same
 * `WorkspaceConversation` the main window shows, in chat-window mode, so streaming, attachments and
 * every attention card (approvals, questions, browser takeover, secure input) work here unchanged and
 * answer through the same IPC.
 */
export function BubbleShell(props: { account: () => CentralAuthUser; agentId: string }) {
  const bubbles = useBubbles();
  const { t } = useText();
  const platform = usePlatform();
  const { agentList } = useAgents();
  const { activeTurns, queues, failedTurns, usageLimits, pendingPrompts, pendingApprovals, approvals } = useTurns();
  const { unreadReplies, recentReplies } = useConversation();
  const agent = createMemo(() => agentList().find((candidate) => candidate.id === props.agentId) ?? null);
  const state = () => bubbles.bubbleOf(props.agentId);
  const expanded = () => state()?.expanded ?? false;
  const label = () => attachedLabel(state()?.attached ?? null);
  const character = () => bubbleCharacter(bubbles.characterOf(props.agentId));
  const [motion, setMotion] = createSignal<BubbleOrbMotion>("rest");
  const [lifted, setLifted] = createSignal(false);
  const hint = () => bubbles.hintOf(props.agentId);
  // Carrying and arming win over the ambient motions.
  const orbMotion = (): BubbleOrbMotion => (lifted() ? (hint() ? "armed" : "lift") : motion());

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
  // Secure input and Done/Cancel answer in the bubble. The page itself is in the embedded browser,
  // which only the main window shows, so the bubble sends the user there for it.
  const takeoverWaiting = () => {
    const current = sidebarState();
    return current?.kind === "waiting" && current.reason === "takeover";
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
    lift: setLifted,
  });

  let motionTimer: ReturnType<typeof setTimeout> | undefined;
  const play = (next: Exclude<BubbleOrbMotion, "rest">, duration: number) => {
    clearTimeout(motionTimer);
    setMotion(next);
    motionTimer = setTimeout(() => setMotion("rest"), duration);
  };

  // A reply that arrives or an answer the agent needs nudges the user: main moves the orb to the
  // pointer (once a minute at most) and it wiggles there. Reduced motion keeps it home and still.
  let previousStatus: BubbleStatus | null = null;
  createEffect(
    () => ({ next: status(), open: expanded() }),
    ({ next, open }) => {
      const before = previousStatus;
      previousStatus = next;
      if (before === null || before === next || open) return;
      if (next !== "attention" && next !== "unread") return;
      if (prefersReducedMotion()) return;
      bubbles.nudge();
      play("nudge", NUDGE_MS);
    },
  );

  // Now and then a resting orb hops in place, so it reads as alive; only on screen, only collapsed.
  onSettled(() => {
    let hopTimer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = HOP_DELAY_MS.min + Math.random() * (HOP_DELAY_MS.max - HOP_DELAY_MS.min);
      hopTimer = setTimeout(() => {
        if (!expanded() && motion() === "rest" && document.visibilityState === "visible" && !prefersReducedMotion())
          play("hop", HOP_MS);
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      clearTimeout(hopTimer);
      clearTimeout(motionTimer);
    };
  });

  // The window is transparent around the orb and the panel card. A collapsed orb hides notifications.
  createEffect(expanded, (open) => {
    document.documentElement.dataset.bubbleWindow = open ? "expanded" : "collapsed";
  });
  onCleanup(() => {
    delete document.documentElement.dataset.bubbleWindow;
  });

  const issue = () => bubbles.issueOf(props.agentId);
  const missingPermission = () => {
    const current = issue();
    if (current === "permission-screen-recording") return "screen-recording" as const;
    if (current === "permission-accessibility") return "accessibility" as const;
    return null;
  };
  const browserHost = () => {
    const url = state()?.attached?.browserUrl;
    return url && URL.canParse(url) ? new URL(url).host : null;
  };

  return (
    <div class="bubble-window" data-platform={platform.appInfo()?.platform}>
      <Show when={agent()}>
        {(current) => (
          <Show
            when={expanded()}
            fallback={
              <BubbleOrb
                agent={current()}
                character={character()}
                status={status()}
                mood={mood()}
                motion={orbMotion()}
                attachHint={hint() ? t("bubbles.attachHint", { app: hint() ?? "" }) : null}
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
                  character={character()}
                  mood={mood()}
                  attachedLabel={label()}
                  onDetach={() => bubbles.detach(props.agentId)}
                  onCollapse={() => bubbles.setExpanded(props.agentId, false)}
                  onOpenMain={() => bubbles.focusMain(props.agentId)}
                  onClose={() => bubbles.bringBack(props.agentId)}
                />
                <Show when={issue()}>
                  {(current) => (
                    <BubbleNotice
                      message={t(ISSUE_TEXT[current()])}
                      action={t(missingPermission() ? "bubbles.openSettings" : "bubbles.notNow")}
                      onAction={() => {
                        const permission = missingPermission();
                        if (permission) bubbles.openPermissionPane(permission);
                        bubbles.dismissIssue(props.agentId);
                      }}
                      dismiss={
                        missingPermission()
                          ? { label: t("bubbles.notNow"), onDismiss: () => bubbles.dismissIssue(props.agentId) }
                          : undefined
                      }
                    />
                  )}
                </Show>
                <Show when={!issue() && browserHost()}>
                  {(host) => (
                    <BubbleNotice
                      message={t("bubbles.browserNotice", { host: host() })}
                      action={t("bubbles.openInBrowser")}
                      onAction={() => bubbles.openAttachedInBrowser(props.agentId)}
                    />
                  )}
                </Show>
                <Show when={!issue() && !browserHost() && takeoverWaiting()}>
                  <BubbleNotice
                    message={t("bubbles.takeoverNotice", { name: current().name })}
                    action={t("bubbles.openBrowser")}
                    onAction={() => bubbles.focusMain(props.agentId)}
                  />
                </Show>
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
