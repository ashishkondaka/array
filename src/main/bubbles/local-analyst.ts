// "Local Analyst" (OpenBot Bubbles fork): a seed agent on a model that runs on this computer, so
// there is a bubble to play with at no cost.
//
// On the first start that finds Ollama or LM Studio, the server is saved as a custom endpoint (the
// same OpenAI-compatible path a user adds in Settings). The agent is created once that endpoint's
// model is in the model catalogue, which needs OpenCode, the runtime OpenBot downloads on request. So
// the seed waits, across starts, until the model is there, and then runs once.

import { join } from "node:path";
import type {
  AgentModelOption,
  AgentSummary,
  CreateAgentInput,
  CustomProviderSummary,
  DetectedModel,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { DEFAULT_MODEL_SERVERS, type DefaultModelServerId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { PreferenceStore } from "../preference-file";

const logger = createOpenBotLogger("local-analyst");

export const LOCAL_ANALYST_FILE = "openbot-local-analyst-v1.json";
const PROBE_TIMEOUT_MS = 1_500;
/** Ollama first: it is the one most people run. */
const LOCAL_SERVERS: readonly DefaultModelServerId[] = ["ollama", "lmstudio"];
/** At most this many of the server's models go into the endpoint; the user can add the rest. */
const ENDPOINT_MODELS = 20;

export interface LocalAnalystState {
  /** The custom endpoint the seed saved or found, and the model it picked. */
  endpointId: string | null;
  modelId: string | null;
  /** The agent was created; the seed never runs again. */
  done: boolean;
}

const EMPTY: LocalAnalystState = { endpointId: null, modelId: null, done: false };

export function decodeLocalAnalystFile(parsed: unknown): LocalAnalystState | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 && value.length <= 256 ? value : null;
  return { endpointId: text(parsed.endpointId), modelId: text(parsed.modelId), done: parsed.done === true };
}

/** A small chat model reads better as an analyst than an embedding or vision model. */
export function preferredModel(models: readonly DetectedModel[]): string | null {
  const usable = models.filter((model) => !/embed|vision|whisper|tts|rerank/iu.test(model.id));
  return (usable[0] ?? models[0])?.id ?? null;
}

/** The endpoint id for a server: one the user saved for that address, or the fork's own. */
export function endpointIdFor(
  server: DefaultModelServerId,
  baseUrl: string,
  saved: readonly Pick<CustomProviderSummary, "id" | "baseUrl">[],
): { id: string; existing: boolean } {
  const normal = (url: string) => url.replace(/\/+$/u, "");
  const match = saved.find((endpoint) => normal(endpoint.baseUrl) === normal(baseUrl));
  return match ? { id: match.id, existing: true } : { id: `local-${server}`, existing: false };
}

/** The catalogue entry of the seeded model, once OpenCode lists it. */
export function seededModel<Model extends Pick<AgentModelOption, "id">>(
  state: LocalAnalystState,
  catalogue: readonly Model[],
): Model | null {
  if (!state.endpointId || !state.modelId) return null;
  const id = `${state.endpointId}/${state.modelId}`;
  return catalogue.find((model) => model.id === id) ?? null;
}

export function localAnalystInput(model: AgentModelOption): CreateAgentInput {
  return {
    name: "Local Analyst",
    description:
      "An analyst that runs on a model on this computer. It reads what the user shares, finds the numbers and the claims, and says plainly what holds up and what does not. Short answers, no tools unless asked.",
    avatarSeed: "local-analyst",
    avatarHue: 150,
    initialMessage:
      "Introduce yourself in two sentences: you are a local analyst that runs on this computer's own model, so nothing leaves it.",
    provider: model.provider,
    model: model.id,
  };
}

export interface LocalAnalystDependencies {
  userDataPath: string;
  probe: (baseUrl: string, timeoutMs: number) => Effect.Effect<readonly DetectedModel[], unknown>;
  savedEndpoints: () => readonly CustomProviderSummary[];
  saveEndpoint: (input: SaveCustomProviderInput) => Effect.Effect<unknown, unknown>;
  catalogue: () => readonly AgentModelOption[];
  createAgent: (input: CreateAgentInput) => Effect.Effect<AgentSummary, unknown>;
}

export class LocalAnalystSeed {
  readonly #deps: LocalAnalystDependencies;
  readonly #store: PreferenceStore<LocalAnalystState>;
  #creating = false;

  constructor(deps: LocalAnalystDependencies) {
    this.#deps = deps;
    this.#store = new PreferenceStore<LocalAnalystState>({
      path: join(deps.userDataPath, LOCAL_ANALYST_FILE),
      defaultValue: EMPTY,
      decode: decodeLocalAnalystFile,
    });
  }

  /** Once at start: find a local server and save it as an endpoint, then try to create the agent. */
  start(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      yield* this.#store.load().pipe(Effect.catch(() => Effect.void));
      const state = this.#store.get();
      if (state.done) return;
      if (!state.endpointId) yield* this.#findServer();
      yield* this.tryCreate();
    }).pipe(
      Effect.catch((error) => Effect.sync(() => logger.warn("The local analyst seed stopped:", toLogValue(error)))),
    );
  }

  /** After each catalogue change: the seeded model may have arrived. */
  tryCreate(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const state = this.#store.get();
      if (state.done || this.#creating) return;
      const model = seededModel(state, this.#deps.catalogue());
      if (!model) return;
      this.#creating = true;
      const created = yield* Effect.result(this.#deps.createAgent(localAnalystInput(model)));
      this.#creating = false;
      if (created._tag === "Failure") {
        logger.warn("Could not create the local analyst:", toLogValue(created.failure));
        return;
      }
      yield* this.#store.set({ ...this.#store.get(), done: true }).pipe(Effect.catch(() => Effect.void));
      logger.info("Created the local analyst on a model of this computer.");
    });
  }

  #findServer(): Effect.Effect<void, unknown> {
    return Effect.gen({ self: this }, function* () {
      for (const server of LOCAL_SERVERS) {
        const { name, baseUrl } = DEFAULT_MODEL_SERVERS[server];
        const models = yield* this.#deps.probe(baseUrl, PROBE_TIMEOUT_MS).pipe(Effect.catch(() => Effect.succeed([])));
        const saved = this.#deps.savedEndpoints();
        const endpoint = endpointIdFor(server, baseUrl, saved);
        // An endpoint the user saved already: pick from the models it lists, which are the ones
        // OpenCode will offer.
        const listed = saved.find((candidate) => candidate.id === endpoint.id)?.models ?? [];
        const modelId = preferredModel(endpoint.existing ? listed : models);
        if (!modelId) continue;
        if (!endpoint.existing) {
          yield* this.#deps.saveEndpoint({
            id: endpoint.id,
            name: `${name} (this computer)`,
            baseUrl,
            apiKey: null,
            models: models.slice(0, ENDPOINT_MODELS).map((model) => ({ id: model.id, name: model.id })),
            headers: [],
          });
        }
        yield* this.#store.set({ endpointId: endpoint.id, modelId, done: false });
        logger.info(`Saved a local model server for the local analyst: ${name}.`);
        return;
      }
    });
  }
}
