// @vitest-environment node

import { describe, expect, it } from "vitest";
import { decodeLocalAnalystFile, endpointIdFor, preferredModel, seededModel } from "./local-analyst";

describe("the local analyst seed", () => {
  it("prefers a chat model over embedding and vision models", () => {
    expect(preferredModel([{ id: "nomic-embed-text" }, { id: "llama3.2:latest" }])).toBe("llama3.2:latest");
    expect(preferredModel([{ id: "nomic-embed-text" }])).toBe("nomic-embed-text");
    expect(preferredModel([])).toBeNull();
  });

  it("reuses an endpoint the user saved for the same address", () => {
    const saved = [{ id: "my-ollama", baseUrl: "http://127.0.0.1:11434/v1/" }];
    expect(endpointIdFor("ollama", "http://127.0.0.1:11434/v1", saved)).toEqual({ id: "my-ollama", existing: true });
    expect(endpointIdFor("lmstudio", "http://127.0.0.1:1234/v1", saved)).toEqual({
      id: "local-lmstudio",
      existing: false,
    });
  });

  it("waits until the catalogue lists the seeded model", () => {
    const state = { endpointId: "local-ollama", modelId: "llama3.2:latest", done: false };
    const model = { id: "local-ollama/llama3.2:latest" };
    expect(seededModel(state, [])).toBeNull();
    expect(seededModel(state, [model])?.id).toBe("local-ollama/llama3.2:latest");
    expect(seededModel({ ...state, endpointId: null }, [model])).toBeNull();
  });

  it("reads its state file and nothing else", () => {
    expect(decodeLocalAnalystFile({ version: 1, endpointId: "local-ollama", modelId: "m", done: true })).toEqual({
      endpointId: "local-ollama",
      modelId: "m",
      done: true,
    });
    expect(decodeLocalAnalystFile({ version: 2 })).toBeNull();
    expect(decodeLocalAnalystFile({ version: 1, endpointId: 7 })).toEqual({
      endpointId: null,
      modelId: null,
      done: false,
    });
  });
});
