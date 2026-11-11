/**
 * Server side of `threadRuns`. The model comes from the thread's resolved
 * execution options, which BB takes from its latest turn request; the start of
 * a running turn is its latest `turn/started` event. Model ids resolve to the
 * provider catalog's display names, cached per provider.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ThreadRun } from "./server";
import { compactModelName } from "./thread-run";

type Sdk = BbPluginApi["sdk"];

export interface ThreadRunRequest {
  threadId: string;
  providerId: string;
  /** Read the running turn's start too. */
  working: boolean;
}

const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_RETRY_MS = 60_000;
/** Threads read at once; a cold sidebar asks for every rendered row in one call. */
const PARALLEL = 8;

export function createThreadRunReader(sdk: Sdk): (requests: readonly ThreadRunRequest[]) => Promise<ThreadRun[]> {
  const catalogs = new Map<string, { expiresAt: number; names: Promise<ReadonlyMap<string, string>> }>();

  const catalog = (providerId: string): Promise<ReadonlyMap<string, string>> => {
    const cached = catalogs.get(providerId);
    if (cached && cached.expiresAt > Date.now()) return cached.names;
    const entry = {
      expiresAt: Date.now() + CATALOG_TTL_MS,
      names: sdk.providers.models({ providerId }).then(
        (result) => new Map(result.models.flatMap((entry) => [[entry.model, entry.displayName], [entry.id, entry.displayName]] as const)),
        () => {
          // An unreachable provider keeps raw ids for a minute, then asks again.
          entry.expiresAt = Date.now() + CATALOG_RETRY_MS;
          return new Map<string, string>();
        },
      ),
    };
    catalogs.set(providerId, entry);
    return entry.names;
  };

  const readOne = async ({ threadId, providerId, working }: ThreadRunRequest): Promise<ThreadRun> => {
    const [execution, turnStartedAt] = await Promise.all([
      sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null),
      working
        ? sdk.threads.events
            .list({ threadId, types: ["turn/started"], order: "desc", limit: "1" })
            .then((events) => events[0]?.createdAt ?? null, () => null)
        : null,
    ]);
    const model = execution?.model ?? null;
    const names = model === null ? null : await catalog(providerId);
    return {
      threadId,
      model,
      modelLabel: model === null ? null : compactModelName(names?.get(model) ?? model),
      reasoningLevel: execution?.reasoningLevel ?? null,
      turnStartedAt,
    };
  };

  return async (requests) => {
    const runs: ThreadRun[] = [];
    for (let index = 0; index < requests.length; index += PARALLEL) {
      runs.push(...(await Promise.all(requests.slice(index, index + PARALLEL).map(readOne))));
    }
    return runs;
  };
}
