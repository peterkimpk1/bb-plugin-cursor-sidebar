import { useEffect, useSyncExternalStore } from "react";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadRun, cursorSidebarRpcContract } from "./server";

/**
 * Each row asks for its own thread's run; the asks of one render are sent as
 * one `threadRuns` call. Answers are kept per thread with the version they
 * answered, so a row repaints from cache when it remounts (a tab switch, a
 * fold) and asks again only when its thread starts or ends a turn.
 */
type Rpc = ReturnType<typeof useRpc<typeof cursorSidebarRpcContract>>;
interface Ask {
  providerId: string;
  working: boolean;
  version: string;
}

const BATCH_DELAY_MS = 30;
const BATCH_SIZE = 200;
const RETRY_AFTER_MS = 30_000;
const KEEP = 3000;

const answers = new Map<string, { version: string; run: ThreadRun | null }>();
const asking = new Map<string, string>();
let queue = new Map<string, Ask>();
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ask(rpc: Rpc, threadId: string, next: Ask) {
  if (answers.get(threadId)?.version === next.version || asking.get(threadId) === next.version) return;
  queue.set(threadId, next);
  timer ??= setTimeout(() => void flush(rpc), BATCH_DELAY_MS);
}

async function flush(rpc: Rpc) {
  timer = null;
  const pending = [...queue];
  queue = new Map();
  for (let index = 0; index < pending.length; index += BATCH_SIZE) {
    const batch = pending.slice(index, index + BATCH_SIZE);
    for (const [threadId, { version }] of batch) asking.set(threadId, version);
    try {
      const { runs } = await rpc.call("threadRuns", {
        threads: batch.map(([threadId, { providerId, working }]) => ({ threadId, providerId, working })),
      });
      const byId = new Map(runs.map((run) => [run.threadId, run]));
      for (const [threadId, { version }] of batch) {
        // A newer ask for the same thread owns its answer.
        if (asking.get(threadId) !== version) continue;
        asking.delete(threadId);
        answers.delete(threadId);
        answers.set(threadId, { version, run: byId.get(threadId) ?? null });
      }
      while (answers.size > KEEP) answers.delete(answers.keys().next().value!);
    } catch {
      // Keep whatever the rows already show (a row with nothing yet stops
      // holding its model line open) and ask again after a pause.
      const retry = batch.filter(([threadId, { version }]) => asking.get(threadId) === version);
      for (const [threadId] of retry) {
        asking.delete(threadId);
        if (!answers.has(threadId)) answers.set(threadId, { version: "failed", run: null });
      }
      if (retry.length > 0) setTimeout(() => retry.forEach(([threadId, next]) => ask(rpc, threadId, next)), RETRY_AFTER_MS);
    }
    emit();
  }
}

/**
 * The thread's latest model and, while `working`, its turn start. Undefined
 * until the first answer arrives; null when the server had nothing for it.
 */
export function useThreadRun(thread: PluginSidebarThread, working: boolean): ThreadRun | null | undefined {
  const rpc = useRpc<typeof cursorSidebarRpcContract>();
  // A finished turn moves latestAttentionAt, and a new one flips `working`.
  const version = `${working ? "working" : "idle"}:${thread.latestAttentionAt}`;
  useEffect(() => {
    ask(rpc, thread.id, { providerId: thread.providerId, working, version });
  }, [rpc, thread.id, thread.providerId, working, version]);
  return useSyncExternalStore(subscribe, () => answers.get(thread.id)?.run);
}
