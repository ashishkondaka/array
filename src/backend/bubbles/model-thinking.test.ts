// @vitest-environment node

import { describe, expect, it } from "vitest";
import { modelCannotThink, noThinkingValue, setModelsWithoutThinking } from "./model-thinking";

describe("model-thinking registry", () => {
  it("knows the models each source registered, and a refresh replaces only that source's set", () => {
    setModelsWithoutThinking("ollama", ["local-ollama/llama3.2:latest"]);
    setModelsWithoutThinking("apple", ["apple-intelligence/apple-foundation"]);
    expect(modelCannotThink("local-ollama/llama3.2:latest")).toBe(true);
    expect(modelCannotThink("apple-intelligence/apple-foundation")).toBe(true);
    expect(modelCannotThink("local-ollama/qwen3:8b")).toBe(false);
    expect(modelCannotThink(null)).toBe(false);
    setModelsWithoutThinking("ollama", []);
    expect(modelCannotThink("local-ollama/llama3.2:latest")).toBe(false);
    expect(modelCannotThink("apple-intelligence/apple-foundation")).toBe(true);
  });

  it("picks the session's own no-thinking value", () => {
    expect(noThinkingValue(["low", "medium", "high", "xhigh", "max", "default"])).toBe("default");
    expect(noThinkingValue(["none", "low"])).toBe("none");
    expect(noThinkingValue(["low", "medium"])).toBeNull();
  });
});
