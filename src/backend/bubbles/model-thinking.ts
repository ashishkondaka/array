// Which models cannot think (OpenBot Bubbles fork). OpenCode applies a thinking level to any model
// it is asked to, and Ollama refuses the whole turn for a model without the "thinking" capability
// ("llama3.2:latest" does not support thinking). Main learns the capabilities from the local servers
// (`src/main/bubbles/thinking-capabilities.ts`) and from the Apple on-device model server
// (`src/main/bubbles/apple-model.ts`), each under a source of its own, and sets them here;
// `applyConfig` then sends no thinking level to such a model, whatever effort the agent's profile holds.

const bySource = new Map<string, ReadonlySet<string>>();

/** The models, as `provider/model`, that cannot think, as one source knows them. Replaces that source's set. */
export function setModelsWithoutThinking(source: string, ids: Iterable<string>): void {
  bySource.set(source, new Set(ids));
}

export function modelCannotThink(modelId: string | null | undefined): boolean {
  if (typeof modelId !== "string") return false;
  for (const ids of bySource.values()) if (ids.has(modelId)) return true;
  return false;
}

/** The agent's own "no thinking level" value among the ones its session lists, or null. */
export function noThinkingValue(values: readonly string[]): string | null {
  for (const candidate of ["default", "none", "off", "disabled"]) if (values.includes(candidate)) return candidate;
  return null;
}
