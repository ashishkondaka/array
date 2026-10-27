// @vitest-environment node

import { describe, expect, it } from "vitest";
import { modelCannotThink, noThinkingValue, setModelsWithoutThinking } from "./model-thinking";

describe("model-thinking registry", () => {
  it("knows the models main registered, and replaces the set on each refresh", () => {
    setModelsWithoutThinking(["local-ollama/llama3.2:latest"]);
    expect(modelCannotThink("local-ollama/llama3.2:latest")).toBe(true);
    expect(modelCannotThink("local-ollama/qwen3:8b")).toBe(false);
    expect(modelCannotThink(null)).toBe(false);
    setModelsWithoutThinking([]);
    expect(modelCannotThink("local-ollama/llama3.2:latest")).toBe(false);
  });

  it("picks the session's own no-thinking value", () => {
    expect(noThinkingValue(["low", "medium", "high", "xhigh", "max", "default"])).toBe("default");
    expect(noThinkingValue(["none", "low"])).toBe("none");
    expect(noThinkingValue(["low", "medium"])).toBeNull();
  });
});
