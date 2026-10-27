// @vitest-environment node

import { describe, expect, it } from "vitest";
import { isOllamaTags, modelsWithoutThinking, ollamaApiOrigin, thinksFromShow } from "./thinking-capabilities";

describe("ollamaApiOrigin", () => {
  it("is the origin beside an OpenAI-compatible /v1, and null elsewhere", () => {
    expect(ollamaApiOrigin("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(ollamaApiOrigin("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434");
    expect(ollamaApiOrigin("http://localhost:1234/v1/openai")).toBeNull();
    expect(ollamaApiOrigin("https://api.example.com")).toBeNull();
    expect(ollamaApiOrigin("not a url")).toBeNull();
  });
});

describe("thinksFromShow and isOllamaTags", () => {
  it("reads the capabilities list", () => {
    expect(thinksFromShow({ capabilities: ["completion", "tools"] })).toBe(false);
    expect(thinksFromShow({ capabilities: ["completion", "thinking"] })).toBe(true);
    expect(thinksFromShow({ details: {} })).toBeNull();
    expect(thinksFromShow(null)).toBeNull();
  });

  it("recognises Ollama's tag list", () => {
    expect(isOllamaTags({ models: [] })).toBe(true);
    expect(isOllamaTags({ data: [] })).toBe(false);
    expect(isOllamaTags("nope")).toBe(false);
  });
});

describe("modelsWithoutThinking", () => {
  it("names only the models known not to think, as provider/model", () => {
    expect(
      modelsWithoutThinking([
        { providerId: "local-ollama", modelId: "llama3.2:latest", thinks: false },
        { providerId: "local-ollama", modelId: "qwen3:8b", thinks: true },
        { providerId: "local-lmstudio", modelId: "mistral", thinks: null },
      ]),
    ).toEqual(["local-ollama/llama3.2:latest"]);
  });
});
