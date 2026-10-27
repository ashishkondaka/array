// Which models cannot think (OpenBot Bubbles fork). OpenCode applies a thinking level to any model
// it is asked to, and Ollama refuses the whole turn for a model without the "thinking" capability
// ("llama3.2:latest" does not support thinking). Main learns the capabilities from the local servers
// (`src/main/bubbles/thinking-capabilities.ts`) and sets them here; `applyConfig` then sends no
// thinking level to such a model, whatever effort the agent's profile holds.

let without = new Set<string>();

/** The models, as `provider/model`, that cannot think. Replaces the previous set. */
export function setModelsWithoutThinking(ids: Iterable<string>): void {
  without = new Set(ids);
}

export function modelCannotThink(modelId: string | null | undefined): boolean {
  return typeof modelId === "string" && without.has(modelId);
}

/** The agent's own "no thinking level" value among the ones its session lists, or null. */
export function noThinkingValue(values: readonly string[]): string | null {
  for (const candidate of ["default", "none", "off", "disabled"]) if (values.includes(candidate)) return candidate;
  return null;
}
