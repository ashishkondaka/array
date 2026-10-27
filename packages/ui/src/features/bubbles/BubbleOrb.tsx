// The collapsed bubble: the agent's avatar in a status ring, and the window it is attached to.
// The renderer owns the drag; this component only draws and reports a press.

import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { Button, Link2 } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import type { BubbleStatus } from "./bubble-status";

export interface BubbleOrbProps {
  agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  status: BubbleStatus;
  mood: AvatarMood;
  unreadCount: number;
  /** "App — window title" while the bubble is attached to a window. */
  attachedLabel: string | null;
  /** The orb is the drag handle; the renderer reads the pointer through these. */
  onPointerDown: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
  onPointerMove: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
  onPointerUp: (event: PointerEvent & { currentTarget: HTMLElement }) => void;
  onClick: () => void;
}

export function BubbleOrb(props: BubbleOrbProps) {
  const { t } = useText();
  const statusLabel = () => {
    switch (props.status) {
      case "working":
        return t("bubbles.statusWorking");
      case "attention":
        return t("bubbles.statusAttention");
      case "unread":
        return t("bubbles.statusUnread", { count: props.unreadCount });
      default:
        return t("bubbles.statusIdle");
    }
  };
  return (
    <div class="bubble-orb-frame" data-attached={props.attachedLabel ? "true" : undefined}>
      {/* A button, so Enter and Space expand it. The pointer handlers make it the drag handle too. */}
      <Button
        variant="ghost"
        type="button"
        class="bubble-orb"
        data-status={props.status}
        aria-label={`${t("bubbles.expand", { name: props.agent.name })}. ${statusLabel()}`}
        title={`${props.agent.name} · ${statusLabel()}`}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onClick={() => props.onClick()}
      >
        <span class="bubble-orb-ring" aria-hidden="true" />
        <AgentAvatar agent={props.agent} mood={props.mood} motion="always" class="bubble-orb-avatar" />
        <Show when={props.status === "unread" && props.unreadCount > 0}>
          <span class="bubble-orb-count" aria-hidden="true">
            {props.unreadCount > 9 ? "9+" : props.unreadCount}
          </span>
        </Show>
      </Button>
      <Show when={props.attachedLabel}>
        {(label) => (
          <span class="bubble-orb-chip" title={label()}>
            <Link2 aria-hidden="true" />
            <span class="bubble-orb-chip-text">{label()}</span>
          </span>
        )}
      </Show>
    </div>
  );
}
