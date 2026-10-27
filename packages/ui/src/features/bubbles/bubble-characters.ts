// The bubble characters (OpenBot Bubbles fork): a body shape and a colour of the agent avatar engine
// each, chosen so no two look alike. The agent keeps its own eyes and face; the character is its body.

import type { SupportedAvatarSilhouetteId } from "@openbot/brand/bloub-avatar";
import { type AvatarHue, BUBBLE_CHARACTER_IDS, type BubbleCharacterId } from "@openbot/contracts/ipc";

export interface BubbleCharacter {
  id: BubbleCharacterId;
  shape: SupportedAvatarSilhouetteId;
  hue: AvatarHue;
}

const LOOKS: Readonly<Record<BubbleCharacterId, Omit<BubbleCharacter, "id">>> = {
  pip: { shape: "cercle", hue: 215 },
  pebble: { shape: "galet", hue: 55 },
  nimbus: { shape: "nuage", hue: 185 },
  hexa: { shape: "hexagone", hue: 245 },
  bean: { shape: "capsule", hue: 100 },
  spark: { shape: "triangle", hue: 0 },
  cubby: { shape: "squircle", hue: 30 },
  rosie: { shape: "cercle", hue: 320 },
};

export const BUBBLE_CHARACTERS: readonly BubbleCharacter[] = BUBBLE_CHARACTER_IDS.map((id) => ({ id, ...LOOKS[id] }));

export function bubbleCharacter(id: BubbleCharacterId | null | undefined): BubbleCharacter | null {
  return id ? { id, ...LOOKS[id] } : null;
}
