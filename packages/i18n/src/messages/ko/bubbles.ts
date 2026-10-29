import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/bubbles";

// OpenBot Bubbles fork: no translations yet, so the English strings show.
export const messages = {} as const satisfies PartialTranslation<typeof source>;
