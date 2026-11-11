/**
 * Decisions come from the Opsdesk plugin: every open Tasks task with the
 * `decision` or `approval` label, per Opsdesk project, plus answers whose
 * asking thread was not told. A plugin's app can only call its own
 * RPC, so this server forwards to Opsdesk's `listProjects`, `getDecisions` and
 * `answerDecision`. Opsdesk stays the owner of what a decision is and what an
 * answer writes; this file only gathers every project's queue into one list.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

type Sdk = BbPluginApi["sdk"];

export const OPSDESK_PLUGIN_ID = "opsdesk";

export const decisionRowSchema = z.object({
  taskId: z.string(),
  key: z.string(),
  title: z.string(),
  kind: z.enum(["decision", "approval"]).catch("decision"),
  summary: z.string().catch(""),
  defaultPick: z.string().nullable().catch(null),
  dueDate: z.string().nullable().catch(null),
  isOverdue: z.boolean().catch(false),
  hasDefaulted: z.boolean().catch(false),
  parentKey: z.string().nullable().catch(null),
  parentTitle: z.string().nullable().catch(null),
});
export type DecisionRow = z.infer<typeof decisionRowSchema>;

/** An answered task whose asking thread was not told the answer. */
export const undeliveredAnswerSchema = z.object({
  taskId: z.string(),
  key: z.string(),
  title: z.string(),
  /** The answer as recorded on the task; empty when not known yet. */
  answer: z.string().catch(""),
  outcome: z.enum(["no-asker", "asker-gone", "failed", "not-sent", "interrupted"]).catch("failed"),
  threadId: z.string().nullable().catch(null),
  detail: z.string().nullable().catch(null),
});
export type UndeliveredAnswer = z.infer<typeof undeliveredAnswerSchema>;

/** What Opsdesk reports about telling the asker; null when nothing was recorded. */
export const decisionDeliverySchema = z.object({
  outcome: z.string(),
  threadId: z.string().nullable().catch(null),
  detail: z.string().nullable().catch(null),
});
export type DecisionDelivery = z.infer<typeof decisionDeliverySchema>;

export { isSettledDelivery } from "./decision-delivery";

const decisionProjectSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  rows: z.array(decisionRowSchema),
  undelivered: z.array(undeliveredAnswerSchema),
  /** Why this project's queue could not be read; null when it was. */
  error: z.string().nullable(),
});
export type DecisionProject = z.infer<typeof decisionProjectSchema>;

export const decisionsResultSchema = z.object({
  /** False when Opsdesk is not installed or not answering. */
  available: z.boolean(),
  reason: z.string().nullable(),
  projects: z.array(decisionProjectSchema),
});
export type DecisionsResult = z.infer<typeof decisionsResultSchema>;

export const decisionAnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("accept-default") }).strict(),
  // Clears a decision that already went ahead with its default.
  z.object({ kind: z.literal("dismiss") }).strict(),
  z.object({ kind: z.literal("approve"), note: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal("decline"), note: z.string().max(4000) }).strict(),
  z.object({ kind: z.literal("answer"), note: z.string().max(4000) }).strict(),
]);
export type DecisionAnswer = z.infer<typeof decisionAnswerSchema>;

const upstreamProjectsSchema = z.object({
  projects: z.array(z.object({ id: z.string(), name: z.string(), hasTasksProject: z.boolean() })),
});
// An Opsdesk without delivery tracking sends no `undelivered` and no `delivery`.
const upstreamQueueSchema = z.object({
  rows: z.array(decisionRowSchema),
  undelivered: z.array(undeliveredAnswerSchema).catch([]),
});
export const answerResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  delivery: decisionDeliverySchema.nullable().catch(null),
});
const acknowledgeResultSchema = z.object({ ok: z.boolean(), error: z.string().nullable() });

/** Every open window polls; one read serves them all for this long. */
const SHARED_READ_MS = 45_000;
/**
 * Tasks rejects a paged read when tasks change mid-read, which busy agents do
 * often, so a failed project read is tried again after these pauses.
 */
const RETRY_PAUSES_MS = [300, 1_000];

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function createDecisionsBridge(sdk: Sdk) {
  let shared: { at: number; result: Promise<DecisionsResult> } | null = null;

  const read = async (): Promise<DecisionsResult> => {
    let projects: z.infer<typeof upstreamProjectsSchema>["projects"];
    try {
      ({ projects } = await sdk.plugins.callRpc({
        pluginId: OPSDESK_PLUGIN_ID,
        method: "listProjects",
        input: null,
        outputSchema: upstreamProjectsSchema,
      }));
    } catch (cause) {
      return { available: false, reason: describe(cause), projects: [] };
    }
    const queues = await Promise.all(
      projects
        .filter((project) => project.hasTasksProject)
        .map(async (project): Promise<DecisionProject> => {
          for (let attempt = 0; ; attempt++) {
            try {
              const queue = await sdk.plugins.callRpc({
                pluginId: OPSDESK_PLUGIN_ID,
                method: "getDecisions",
                input: { projectId: project.id },
                outputSchema: upstreamQueueSchema,
              });
              return { projectId: project.id, name: project.name, rows: queue.rows, undelivered: queue.undelivered, error: null };
            } catch (cause) {
              const pause = RETRY_PAUSES_MS[attempt];
              if (pause === undefined) return { projectId: project.id, name: project.name, rows: [], undelivered: [], error: describe(cause) };
              await new Promise((resolve) => setTimeout(resolve, pause));
            }
          }
        }),
    );
    return { available: true, reason: null, projects: queues };
  };

  return {
    list(fresh: boolean): Promise<DecisionsResult> {
      if (!fresh && shared !== null && Date.now() - shared.at < SHARED_READ_MS) return shared.result;
      const result = read();
      const entry = { at: Date.now(), result };
      shared = entry;
      // A read with a failed project is not shared: the next poll tries again.
      void result.then((value) => {
        if (shared === entry && (!value.available || value.projects.some((project) => project.error !== null))) shared = null;
      });
      return result;
    },
    async answer(input: { projectId: string; taskId: string; answer: DecisionAnswer }) {
      const result = await sdk.plugins.callRpc({
        pluginId: OPSDESK_PLUGIN_ID,
        method: "answerDecision",
        input,
        outputSchema: answerResultSchema,
      });
      shared = null;
      return result;
    },
    async retryDelivery(input: { projectId: string; taskId: string }) {
      const result = await sdk.plugins.callRpc({
        pluginId: OPSDESK_PLUGIN_ID,
        method: "retryDecisionDelivery",
        input,
        outputSchema: answerResultSchema,
      });
      shared = null;
      return result;
    },
    async acknowledgeDelivery(input: { projectId: string; taskId: string }) {
      const result = await sdk.plugins.callRpc({
        pluginId: OPSDESK_PLUGIN_ID,
        method: "acknowledgeDecisionDelivery",
        input,
        outputSchema: acknowledgeResultSchema,
      });
      shared = null;
      return result;
    },
  };
}
