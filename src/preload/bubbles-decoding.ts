// What main sends about floating agent bubbles (OpenBot Bubbles fork).

import {
  type BubbleAttachStatus,
  type BubblesSnapshot,
  isBubbleAttachStatus,
  isBubblesSnapshot,
} from "@openbot/contracts/ipc";

export function decodeBubblesSnapshot(value: unknown): BubblesSnapshot {
  if (isBubblesSnapshot(value)) return value;
  throw new Error("Invalid bubbles snapshot.");
}

export function decodeBubbleAttachStatus(value: unknown): BubbleAttachStatus {
  if (isBubbleAttachStatus(value)) return value;
  throw new Error("Invalid bubble attach status.");
}
