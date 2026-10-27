// Payloads of the `bubbles` IPC group (OpenBot Bubbles fork). Each parser rebuilds only the known keys.

import {
  BUBBLE_LIMITS,
  type BubbleCharacterInput,
  type BubbleDragPoint,
  type BubbleExpandedInput,
  isBubbleCharacterId,
  isBubbleDragPoint,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { requireString } from "./validation";

export function parseBubbleAgentId(input: unknown): string {
  return requireString(input, "Agent");
}

export function parseBubbleExpanded(input: unknown): BubbleExpandedInput {
  if (!isDynamicRecord(input)) throw new Error("A bubble change is required.");
  if (!isBoolean(input.expanded)) throw new Error("Expanded must be a boolean.");
  return { agentId: requireString(input.agentId, "Agent"), expanded: input.expanded };
}

export function parseBubbleHidden(input: unknown): boolean {
  if (!isBoolean(input)) throw new Error("Hidden must be a boolean.");
  return input;
}

export function parseBubbleAttachOnRelease(input: unknown): boolean {
  if (!isBoolean(input)) throw new Error("Attach must be a boolean.");
  return input;
}

export function parseBubbleDragPoint(input: unknown): BubbleDragPoint {
  if (!isBubbleDragPoint(input)) {
    throw new Error(`A drag point is two integers within ${BUBBLE_LIMITS.coordinate} points of the origin.`);
  }
  return { x: input.x, y: input.y, attach: input.attach };
}

export function parseBubbleCharacter(input: unknown): BubbleCharacterInput {
  if (!isDynamicRecord(input)) throw new Error("A character choice is required.");
  if (input.character !== null && !isBubbleCharacterId(input.character)) throw new Error("Unknown character.");
  return { agentId: requireString(input.agentId, "Agent"), character: input.character };
}

export function parseBubbleNudges(input: unknown): boolean {
  if (!isBoolean(input)) throw new Error("Nudges must be a boolean.");
  return input;
}
