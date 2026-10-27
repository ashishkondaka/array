/**
 * bubbles: the "Bubble character" submenu on an agent (OpenBot Bubbles fork). Each item previews the
 * character with the agent's own face, so the choice is made by looking, not by reading a name.
 */

import type { BubbleCharacterId } from "@openbot/contracts/ipc";
import { Check, ChevronRight, ContextMenu, PictureInPicture2 } from "@openbot/ui";
import { For, Show } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { BUBBLE_CHARACTERS } from "../bubbles/bubble-characters";
import { useSidebarScope } from "./sidebar-scope";

const CHARACTER_NAMES = {
  pip: "bubbles.character.pip",
  pebble: "bubbles.character.pebble",
  nimbus: "bubbles.character.nimbus",
  hexa: "bubbles.character.hexa",
  bean: "bubbles.character.bean",
  spark: "bubbles.character.spark",
  cubby: "bubbles.character.cubby",
  rosie: "bubbles.character.rosie",
} as const satisfies Record<BubbleCharacterId, string>;

export function SidebarBubbleCharacterSubmenu(menuProps: { agent: AgentProfile }) {
  const { props } = useSidebarScope();
  const { t } = useText();
  const current = () => props.bubbleCharacterOf?.(menuProps.agent.id) ?? null;
  return (
    <Show when={props.onChooseBubbleCharacter}>
      {(choose) => (
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger>
            <PictureInPicture2 class="agent-context-icon size-4" aria-hidden="true" />
            <span>{t("bubbles.character")}</span>
            <ChevronRight class="agent-context-submenu-chevron size-4" aria-hidden="true" />
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent
              class="ui-action-menu agent-context-menu agent-context-submenu"
              aria-label={t("bubbles.character")}
            >
              <ContextMenu.Item onSelect={() => choose()(menuProps.agent.id, null)}>
                <Show
                  when={current() === null}
                  fallback={<AgentAvatar agent={menuProps.agent} motion="idle" class="agent-context-icon size-4" />}
                >
                  <Check class="agent-context-icon size-4" aria-hidden="true" />
                </Show>
                <span>{t("bubbles.characterOwn")}</span>
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <For each={BUBBLE_CHARACTERS}>
                {(character) => (
                  <ContextMenu.Item onSelect={() => choose()(menuProps.agent.id, character.id)}>
                    <Show
                      when={current() === character.id}
                      fallback={
                        <AgentAvatar
                          seed={menuProps.agent.avatarSeed}
                          hue={character.hue}
                          url={null}
                          shape={character.shape}
                          motion="hover"
                          class="agent-context-icon size-4"
                        />
                      }
                    >
                      <Check class="agent-context-icon size-4" aria-hidden="true" />
                    </Show>
                    <span>{t(CHARACTER_NAMES[character.id])}</span>
                  </ContextMenu.Item>
                )}
              </For>
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      )}
    </Show>
  );
}
