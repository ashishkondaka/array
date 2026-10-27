// `openbot-bubbles-v1.json` in `userData`. The file is the user's to edit and a later version may
// write it, so every read is checked again and nothing in it is trusted.

import {
  BUBBLE_LIMITS,
  type BubbleCharacterChoice,
  type BubbleState,
  type BubblesSnapshot,
  isBubbleCharacterChoice,
  isBubbleState,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";

export const BUBBLES_STATE_FILE = "openbot-bubbles-v1.json";

export const EMPTY_BUBBLES: BubblesSnapshot = { bubbles: [], hidden: false, characters: [], nudges: true };

/**
 * Reads a parsed state file. A file of another version or shape reads as null (the default).
 * In a file of this version, an entry that is not valid is dropped and the others are kept, so one
 * damaged entry does not close every bubble. A second entry for one agent and entries past the
 * limit are dropped too.
 */
export function decodeBubblesFile(parsed: unknown): BubblesSnapshot | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.bubbles)) return null;
  const bubbles: BubbleState[] = [];
  const agents = new Set<string>();
  for (const entry of parsed.bubbles) {
    if (bubbles.length >= BUBBLE_LIMITS.bubbles) break;
    if (!isBubbleState(entry) || agents.has(entry.agentId)) continue;
    agents.add(entry.agentId);
    bubbles.push(copyBubble(entry));
  }
  // A file from before characters and nudges existed has neither: no character, nudges on.
  const characters: BubbleCharacterChoice[] = [];
  const chosen = new Set<string>();
  for (const entry of Array.isArray(parsed.characters) ? parsed.characters : []) {
    if (characters.length >= BUBBLE_LIMITS.characters) break;
    if (!isBubbleCharacterChoice(entry) || chosen.has(entry.agentId)) continue;
    chosen.add(entry.agentId);
    characters.push({ agentId: entry.agentId, character: entry.character });
  }
  return {
    bubbles,
    hidden: isBoolean(parsed.hidden) ? parsed.hidden : false,
    characters,
    nudges: isBoolean(parsed.nudges) ? parsed.nudges : true,
  };
}

/** Only the known keys, so an unknown key in the file is not written back. */
export function copyBubble(state: BubbleState): BubbleState {
  return {
    agentId: state.agentId,
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    expanded: state.expanded,
    attached: state.attached
      ? {
          kind: "window",
          appName: state.attached.appName,
          bundleId: state.attached.bundleId,
          title: state.attached.title,
          pid: state.attached.pid,
          windowId: state.attached.windowId,
          bounds: { ...state.attached.bounds },
          attachedAt: state.attached.attachedAt,
          browserUrl: state.attached.browserUrl,
        }
      : null,
  };
}

export function newBubble(agentId: string, position: { x: number; y: number }): BubbleState {
  return {
    agentId,
    x: position.x,
    y: position.y,
    width: BUBBLE_LIMITS.expandedWidth,
    height: BUBBLE_LIMITS.expandedHeight,
    expanded: false,
    attached: null,
  };
}
