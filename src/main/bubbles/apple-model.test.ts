// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  APPLE_MODEL_ENDPOINT_ID,
  APPLE_MODEL_ID,
  appleModel,
  appleModelBinaryPath,
  appleModelEndpoint,
  decodeAppleModelFile,
  readServerHello,
} from "./apple-model";

describe("appleModelBinaryPath", () => {
  const input = {
    resourcesPath: "/App/Contents/Resources",
    sourceRoot: "/src",
    platform: "darwin" as const,
    architecture: "arm64",
  };
  it("is the packaged resource or the checkout's build output, on macOS only", () => {
    expect(appleModelBinaryPath({ ...input, isPackaged: true })).toBe(
      "/App/Contents/Resources/apple-model-server/darwin/arm64/apple-model-server",
    );
    expect(appleModelBinaryPath({ ...input, isPackaged: false })).toBe(
      "/src/build/apple-model-server/darwin/arm64/apple-model-server",
    );
    expect(appleModelBinaryPath({ ...input, isPackaged: true, platform: "win32" })).toBeNull();
  });
});

describe("readServerHello", () => {
  it("reads the server's first line and refuses anything else", () => {
    expect(readServerHello('{"port":48127,"available":true,"reason":"available"}')).toEqual({
      port: 48127,
      available: true,
      reason: "available",
    });
    expect(readServerHello('{"port":0,"available":true}')).toBeNull();
    expect(readServerHello("The listener failed")).toBeNull();
  });
});

describe("the endpoint and the catalogue match", () => {
  it("saves one keyless loopback endpoint with the one model", () => {
    const endpoint = appleModelEndpoint(48127);
    expect(endpoint).toMatchObject({
      id: APPLE_MODEL_ENDPOINT_ID,
      baseUrl: "http://127.0.0.1:48127/v1",
      apiKey: null,
      headers: [],
    });
    expect(endpoint.models.map((model) => model.id)).toEqual([APPLE_MODEL_ID]);
  });

  it("finds the model in the catalogue by its composed id", () => {
    expect(
      appleModel([{ id: "local-ollama/llama3.2:latest" }, { id: "apple-intelligence/apple-foundation" }])?.id,
    ).toBe("apple-intelligence/apple-foundation");
    expect(appleModel([{ id: "local-ollama/llama3.2:latest" }])).toBeNull();
  });

  it("reads its state file and drops an unknown one", () => {
    expect(decodeAppleModelFile({ version: 1, done: true })).toEqual({ done: true });
    expect(decodeAppleModelFile({ version: 2, done: true })).toBeNull();
  });
});
