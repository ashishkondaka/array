// Which models of the user's local servers can think (OpenBot Bubbles fork). Ollama tells, per
// model, in `/api/show` (`capabilities: ["completion", "tools", "thinking"]`); its OpenAI-compatible
// `/v1` does not. A custom endpoint whose origin answers Ollama's `/api/tags` is asked about each of
// its models, and the models without "thinking" go to the backend's registry
// (`src/backend/bubbles/model-thinking.ts`), so no thinking level is ever sent to them. An endpoint
// that is not Ollama (LM Studio, a remote service) says nothing, and its models keep OpenBot's
// behaviour. Read-only: two GETs and one POST per endpoint, on a short timeout.

import type { CustomProviderSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { setModelsWithoutThinking } from "../../backend/bubbles/model-thinking";

const logger = createOpenBotLogger("bubbles-thinking");

/** A local server answers at once; a slow answer is treated as no answer. */
const REQUEST_TIMEOUT_MS = 1_500;

/** Ollama's own API sits beside its OpenAI-compatible `/v1`: `http://host:11434/v1` → `http://host:11434`. */
export function ollamaApiOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    return /^\/v1\/?$/u.test(url.pathname) ? url.origin : null;
  } catch {
    return null;
  }
}

/** Whether `/api/show` says the model thinks; null when the answer has no capabilities list. */
export function thinksFromShow(payload: unknown): boolean | null {
  if (!isDynamicRecord(payload) || !Array.isArray(payload.capabilities)) return null;
  return payload.capabilities.includes("thinking");
}

/** Whether `/api/tags` reads as Ollama's: a record with a `models` list. */
export function isOllamaTags(payload: unknown): boolean {
  return isDynamicRecord(payload) && Array.isArray(payload.models);
}

export interface ModelThinking {
  providerId: string;
  modelId: string;
  thinks: boolean | null;
}

/** The `provider/model` ids OpenCode uses, for the models that are known not to think. */
export function modelsWithoutThinking(entries: readonly ModelThinking[]): string[] {
  return entries.filter((entry) => entry.thinks === false).map((entry) => `${entry.providerId}/${entry.modelId}`);
}

/** The body of Ollama's `/api/show`. */
interface ShowRequest {
  readonly model: string;
}

export interface ThinkingCapabilitiesDependencies {
  providers: () => readonly CustomProviderSummary[];
  fetch: typeof fetch;
}

export class ThinkingCapabilities {
  readonly #deps: ThinkingCapabilitiesDependencies;

  constructor(deps: ThinkingCapabilitiesDependencies) {
    this.#deps = deps;
  }

  /** Asks every Ollama endpoint about its models and replaces the registry. Never fails. */
  refresh(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const entries: ModelThinking[] = [];
      for (const provider of this.#deps.providers()) {
        const origin = ollamaApiOrigin(provider.baseUrl);
        if (!origin) continue;
        const tags = yield* this.#json(`${origin}/api/tags`);
        if (!isOllamaTags(tags)) continue;
        for (const model of provider.models) {
          const show = yield* this.#json(`${origin}/api/show`, { model: model.id });
          entries.push({ providerId: provider.id, modelId: model.id, thinks: thinksFromShow(show) });
        }
      }
      const without = modelsWithoutThinking(entries);
      setModelsWithoutThinking("ollama", without);
      if (entries.length > 0) {
        logger.info("Read the thinking capability of the local models.", {
          models: entries.length,
          withoutThinking: without.length,
        });
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => logger.warn("Could not read the local models' capabilities:", toLogValue(error))),
      ),
    );
  }

  /** One request's JSON, or null for any failure: an endpoint that is down says nothing. */
  #json(url: string, body?: ShowRequest): Effect.Effect<unknown> {
    return Effect.tryPromise(async () => {
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const response = await this.#deps.fetch(
        url,
        body
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }
          : { method: "GET", signal },
      );
      return response.ok ? response.json() : null;
    }).pipe(Effect.catch(() => Effect.succeed(null)));
  }
}
