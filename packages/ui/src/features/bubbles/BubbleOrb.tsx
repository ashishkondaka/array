// The collapsed bubble: the agent as its character in a glass orb with a status glow, and the window
// it is attached to. The renderer owns the drag; this component only draws and reports a press.

import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { Button, Link2 } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import type { BubbleCharacter } from "./bubble-characters";
import type { BubbleStatus } from "./bubble-status";

/**
 * What the orb is doing besides resting: a short hop now and then, a wiggle beside the pointer,
 * lifted while carried, or armed over a window it would attach to on release.
 */
export type BubbleOrbMotion = "rest" | "hop" | "nudge" | "lift" | "armed";

/** The avatar draws at the display rate while the orb moves, and at the shared 30 fps cap otherwise. */
const MOVING_FPS = 120;

export interface BubbleOrbProps {
  agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  character: BubbleCharacter | null;
  status: BubbleStatus;
  mood: AvatarMood;
  motion: BubbleOrbMotion;
  unreadCount: number;
  /** "App — window title" while the bubble is attached to a window. */
  attachedLabel: string | null;
  /** "Release to attach to App" while armed. */
  attachHint: string | null;
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
  // A resting orb holds still until the pointer arrives; it animates while it works, waits or moves.
  const lively = () => props.motion !== "rest" || props.status === "working" || props.status === "attention";
  return (
    <div class="bubble-orb-frame" data-attached={props.attachedLabel ? "true" : undefined}>
      {/* A button, so Enter and Space expand it. The pointer handlers make it the drag handle too. */}
      <Button
        variant="ghost"
        type="button"
        class="bubble-orb"
        data-status={props.status}
        data-motion={props.motion}
        aria-label={`${t("bubbles.expand", { name: props.agent.name })}. ${statusLabel()}`}
        title={props.attachHint ?? `${props.agent.name} · ${statusLabel()}\n${t("bubbles.attachTip")}`}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onClick={() => props.onClick()}
      >
        <span class="bubble-orb-ring" aria-hidden="true" />
        <span class="bubble-orb-body">
          <AgentAvatar
            seed={props.agent.avatarSeed}
            hue={props.character ? props.character.hue : props.agent.avatarHue}
            url={props.character ? null : props.agent.avatarUrl}
            shape={props.character?.shape}
            mood={props.mood}
            motion={lively() ? "always" : "hover"}
            fps={props.motion === "rest" ? undefined : MOVING_FPS}
            class="bubble-orb-avatar"
          />
        </span>
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
