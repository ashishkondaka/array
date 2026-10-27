// The header of an expanded bubble. It is the window's drag region; its buttons are not.

import type { AvatarMood } from "@openbot/brand/bloub-avatar-motion";
import { AppWindow, Button, Link2, Minimize2, X } from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import type { BubbleCharacter } from "./bubble-characters";

export interface BubblePanelHeaderProps {
  agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  mood: AvatarMood;
  attachedLabel: string | null;
  /** Detaches the agent from its window. Shown only while attached. */
  onDetach?: (() => void) | undefined;
  character?: BubbleCharacter | null | undefined;
  onCollapse: () => void;
  onOpenMain: () => void;
  onClose: () => void;
}

export function BubblePanelHeader(props: BubblePanelHeaderProps) {
  const { t } = useText();
  return (
    <header class="bubble-panel-header">
      <AgentAvatar
        seed={props.agent.avatarSeed}
        hue={props.character ? props.character.hue : props.agent.avatarHue}
        url={props.character ? null : props.agent.avatarUrl}
        shape={props.character?.shape}
        mood={props.mood}
        motion="hover"
        class="bubble-panel-avatar"
      />
      <div class="bubble-panel-title">
        <span class="bubble-panel-name">{props.agent.name}</span>
        <Show when={props.attachedLabel}>
          {(label) => (
            <span class="bubble-panel-attached" title={label()}>
              <Link2 aria-hidden="true" />
              <span class="bubble-orb-chip-text">{label()}</span>
            </span>
          )}
        </Show>
      </div>
      <div class="bubble-panel-actions">
        <Show when={props.attachedLabel ? props.onDetach : undefined}>
          {(detach) => (
            <Button variant="ghost" size="sm" type="button" title={t("bubbles.detach")} onClick={() => detach()()}>
              {t("bubbles.detach")}
            </Button>
          )}
        </Show>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t("bubbles.openMain")}
          title={t("bubbles.openMain")}
          onClick={() => props.onOpenMain()}
        >
          <AppWindow aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t("bubbles.collapse")}
          title={t("bubbles.collapse")}
          onClick={() => props.onCollapse()}
        >
          <Minimize2 aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t("bubbles.close")}
          title={t("bubbles.close")}
          onClick={() => props.onClose()}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
