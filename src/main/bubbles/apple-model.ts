// The Apple on-device model in Array (OpenBot Bubbles fork). macOS 26 runs Apple Intelligence's
// language model on the Mac and exposes it to Swift through FoundationModels. Array ships a small
// server (`resources/apple-model-server/main.swift`) that puts it behind the OpenAI-compatible
// routes OpenCode speaks, on 127.0.0.1. Main starts the server, saves it as the custom endpoint
// `apple-intelligence` with the one model `apple-foundation` (the same path a user takes for a
// local Ollama), tells the backend that the model cannot think, and seeds an "Apple Analyst" agent on
// it once OpenCode lists the model. Nothing leaves the Mac. On a Mac without the model (an older
// macOS, Apple Intelligence off, or an Intel Mac) the server says so once and nothing is saved.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  AgentModelOption,
  AgentSummary,
  CreateAgentInput,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { setModelsWithoutThinking } from "../../backend/bubbles/model-thinking";
import { PreferenceStore } from "../preference-file";

const logger = createOpenBotLogger("apple-model");

const APPLE_MODEL_FILE = "openbot-apple-model-v1.json";
export const APPLE_MODEL_ENDPOINT_ID = "apple-intelligence";
export const APPLE_MODEL_ID = "apple-foundation";
/** A fixed port keeps the saved endpoint's address stable; the server falls back to any port if it is taken. */
const APPLE_MODEL_PORT = 48127;
/** The server prints its first line as soon as it listens; a build that cannot start is given this long. */
const HELLO_TIMEOUT_MS = 8_000;

export interface AppleModelState {
  /** The agent was created; the seed never runs again. The endpoint is kept current on every start. */
  done: boolean;
}

const EMPTY: AppleModelState = { done: false };

export function decodeAppleModelFile(parsed: unknown): AppleModelState | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
  return { done: parsed.done === true };
}

/** Where the server binary is: the packaged resources, or the checkout's `build/` in development. */
export function appleModelBinaryPath(input: {
  isPackaged: boolean;
  resourcesPath: string;
  sourceRoot: string;
  platform: NodeJS.Platform;
  architecture: string;
}): string | null {
  if (input.platform !== "darwin") return null;
  const tail = join("apple-model-server", "darwin", input.architecture, "apple-model-server");
  return input.isPackaged ? join(input.resourcesPath, tail) : join(input.sourceRoot, "build", tail);
}

export interface ServerHello {
  port: number;
  available: boolean;
  reason: string;
}

/** The server's first stdout line. Null for anything that is not it. */
export function readServerHello(line: string): ServerHello | null {
  try {
    const parsed = JSON.parse(line);
    if (!isDynamicRecord(parsed) || !Number.isSafeInteger(parsed.port) || Number(parsed.port) <= 0) return null;
    return {
      port: Number(parsed.port),
      available: parsed.available === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return null;
  }
}

function appleModelBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

export function appleModelEndpoint(port: number): SaveCustomProviderInput {
  return {
    id: APPLE_MODEL_ENDPOINT_ID,
    name: "Apple Intelligence (this Mac)",
    baseUrl: appleModelBaseUrl(port),
    apiKey: null,
    models: [{ id: APPLE_MODEL_ID, name: "Apple on-device model" }],
    headers: [],
  };
}

function appleAnalystInput(model: AgentModelOption): CreateAgentInput {
  return {
    name: "Apple Analyst",
    description:
      "An analyst on Apple Intelligence's on-device model: nothing leaves this Mac. It reads what the user shares and answers briefly and plainly. It has a small context window, so it works best with one question or one short document at a time. No tools unless asked.",
    avatarSeed: "apple-analyst",
    avatarHue: 215,
    initialMessage:
      "Introduce yourself in two sentences: you are an analyst that runs on this Mac's own Apple Intelligence model, so nothing you read leaves the Mac.",
    provider: model.provider,
    model: model.id,
  };
}

/** The catalogue entry of the Apple model, once OpenCode lists the endpoint. */
export function appleModel<Model extends Pick<AgentModelOption, "id">>(catalogue: readonly Model[]): Model | null {
  return catalogue.find((model) => model.id === `${APPLE_MODEL_ENDPOINT_ID}/${APPLE_MODEL_ID}`) ?? null;
}

export interface AppleModelDependencies {
  userDataPath: string;
  binaryPath: string | null;
  savedEndpoints: () => readonly CustomProviderSummary[];
  saveEndpoint: (input: SaveCustomProviderInput) => Effect.Effect<unknown, unknown>;
  updateEndpoint: (input: UpdateCustomProviderInput) => Effect.Effect<unknown, unknown>;
  catalogue: () => readonly AgentModelOption[];
  createAgent: (input: CreateAgentInput) => Effect.Effect<AgentSummary, unknown>;
}

export class AppleModelServer {
  readonly #deps: AppleModelDependencies;
  readonly #store: PreferenceStore<AppleModelState>;
  #child: ChildProcess | null = null;
  #port: number | null = null;
  #creating = false;
  #stopped = false;

  constructor(deps: AppleModelDependencies) {
    this.#deps = deps;
    this.#store = new PreferenceStore<AppleModelState>({
      path: join(deps.userDataPath, APPLE_MODEL_FILE),
      defaultValue: EMPTY,
      decode: decodeAppleModelFile,
    });
  }

  /** The port the server listens on, once it does. */
  get port(): number | null {
    return this.#port;
  }

  /** Starts the server and saves or refreshes the endpoint. Nothing to start is not an error. */
  start(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#store.load().pipe(Effect.catch(() => Effect.void));
      const binary = this.#deps.binaryPath;
      if (!binary || !existsSync(binary)) {
        logger.info("No Apple model server in this build; the Apple on-device model is not offered.");
        return;
      }
      const hello = (yield* this.#spawn(binary, APPLE_MODEL_PORT)) ?? (yield* this.#spawn(binary, 0));
      if (!hello) return;
      if (!hello.available) {
        logger.info(`The Apple on-device model is not available on this Mac: ${hello.reason}`);
        this.#stopChild();
        return;
      }
      this.#port = hello.port;
      setModelsWithoutThinking("apple", [`${APPLE_MODEL_ENDPOINT_ID}/${APPLE_MODEL_ID}`]);
      yield* this.#ensureEndpoint(hello.port);
      logger.info(`The Apple on-device model is served on port ${hello.port}.`);
      yield* this.tryCreate();
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => logger.warn("The Apple model server did not start:", toLogValue(error))),
      ),
    );
  }

  /** After each catalogue change: the Apple model may have arrived. */
  tryCreate(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.#port === null || this.#store.get().done || this.#creating) return;
      const model = appleModel(this.#deps.catalogue());
      if (!model) return;
      this.#creating = true;
      const created = yield* Effect.result(this.#deps.createAgent(appleAnalystInput(model)));
      this.#creating = false;
      if (created._tag === "Failure") {
        logger.warn("Could not create the Apple analyst:", toLogValue(created.failure));
        return;
      }
      yield* this.#store.set({ done: true }).pipe(Effect.catch(() => Effect.void));
      logger.info("Created the Apple analyst on this Mac's own model.");
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#stopChild();
  }

  #stopChild(): void {
    const child = this.#child;
    this.#child = null;
    if (!child) return;
    // The server exits when its stdin closes; a kill follows for one that does not.
    child.stdin?.end();
    const timer = setTimeout(() => child.kill(), 1_000);
    child.once("exit", () => clearTimeout(timer));
  }

  /** The saved endpoint points at this run's port; a first run saves it. */
  #ensureEndpoint(port: number): Effect.Effect<void, unknown> {
    const input = appleModelEndpoint(port);
    const saved = this.#deps.savedEndpoints().find((endpoint) => endpoint.id === APPLE_MODEL_ENDPOINT_ID);
    if (!saved) return this.#deps.saveEndpoint(input).pipe(Effect.asVoid);
    if (saved.baseUrl === input.baseUrl) return Effect.void;
    return this.#deps
      .updateEndpoint({ id: input.id, name: saved.name, baseUrl: input.baseUrl, models: input.models })
      .pipe(Effect.asVoid);
  }

  /** Spawns the server on `port` (0: any) and waits for its first line; null when it did not come up. */
  #spawn(binary: string, port: number): Effect.Effect<ServerHello | null> {
    return Effect.promise(
      () =>
        new Promise<ServerHello | null>((resolve) => {
          if (this.#stopped) {
            resolve(null);
            return;
          }
          const child = spawn(binary, ["--port", String(port)], { stdio: ["pipe", "pipe", "pipe"] });
          this.#child = child;
          let buffer = "";
          let settled = false;
          const finish = (hello: ServerHello | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (!hello) {
              this.#child = null;
              child.kill();
            }
            resolve(hello);
          };
          const timer = setTimeout(() => finish(null), HELLO_TIMEOUT_MS);
          child.stdout?.on("data", (data: Buffer) => {
            buffer += data.toString("utf8");
            const line = buffer.indexOf("\n");
            if (line < 0) return;
            finish(readServerHello(buffer.slice(0, line)));
          });
          child.stderr?.on("data", (data: Buffer) => logger.warn("apple-model-server:", data.toString("utf8").trim()));
          child.once("error", (error) => {
            logger.warn("Could not start the Apple model server:", toLogValue(error));
            finish(null);
          });
          child.once("exit", (code) => {
            if (!settled) finish(null);
            else if (this.#child === child) {
              this.#child = null;
              if (!this.#stopped) logger.warn(`The Apple model server exited with code ${code}.`);
            }
          });
        }),
    );
  }
}
