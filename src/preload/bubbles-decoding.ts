// What main sends about floating agent bubbles (OpenBot Bubbles fork).

import { type BubblesSnapshot, isBubblesSnapshot } from "@openbot/contracts/ipc";

export function decodeBubblesSnapshot(value: unknown): BubblesSnapshot {
  if (isBubblesSnapshot(value)) return value;
  throw new Error("Invalid bubbles snapshot.");
}
