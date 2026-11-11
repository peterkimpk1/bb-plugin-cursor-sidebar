import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { DecisionAnswer, DecisionDelivery, DecisionProject, UndeliveredAnswer, cursorSidebarRpcContract } from "./server";
import { isSettledDelivery } from "./decision-delivery";

/** Opsdesk publishes on its own channel, which this plugin cannot hear, so the queue polls. */
const POLL_MS = 2 * 60_000;

export type DecisionsState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string | null }
  | { status: "ready"; projects: DecisionProject[] };

export interface Decisions {
  state: DecisionsState;
  /** Open decisions and approvals, plus answers the asker was not told, across every project. */
  count: number;
  /** Past due and still waiting; a decision that went ahead with its default is not. */
  overdue: number;
  /** `fresh` skips the server's shared read, e.g. when the list opens. */
  refresh: (fresh?: boolean) => Promise<void>;
  /**
   * Records the answer through Opsdesk; throws its error so the card can show
   * it. Resolves with what Opsdesk reported about telling the asker.
   */
  answer: (projectId: string, taskId: string, answer: DecisionAnswer) => Promise<DecisionDelivery | null>;
  /** Sends an undelivered answer again; throws Opsdesk's error. */
  retryDelivery: (projectId: string, taskId: string) => Promise<DecisionDelivery | null>;
  /** Leaves an answer undelivered on purpose; throws Opsdesk's error. */
  acknowledgeDelivery: (projectId: string, taskId: string) => Promise<void>;
}

const OUTCOMES: readonly UndeliveredAnswer["outcome"][] = ["no-asker", "asker-gone", "failed", "not-sent", "interrupted"];

function toUndelivered(row: { taskId: string; key: string; title: string }, delivery: DecisionDelivery): UndeliveredAnswer {
  const outcome = OUTCOMES.find((candidate) => candidate === delivery.outcome) ?? "failed";
  return { taskId: row.taskId, key: row.key, title: row.title, answer: "", outcome, threadId: delivery.threadId, detail: delivery.detail };
}

export function useDecisions(): Decisions {
  const rpc = useRpc<typeof cursorSidebarRpcContract>();
  const [state, setState] = useState<DecisionsState>({ status: "loading" });
  const generation = useRef(0);

  const refresh = useCallback(
    async (fresh = false) => {
      const mine = ++generation.current;
      try {
        const result = await rpc.call("decisions", { fresh });
        if (mine !== generation.current) return;
        if (!result.available) {
          setState({ status: "unavailable", reason: result.reason });
          return;
        }
        // A project that failed this read keeps the cards it had, so a busy
        // Tasks store does not empty the list or the count between polls.
        setState((current) => {
          const previous = new Map(current.status === "ready" ? current.projects.map((project) => [project.projectId, project]) : []);
          const projects = result.projects.map((project) =>
            project.error === null
              ? project
              : {
                  ...project,
                  rows: previous.get(project.projectId)?.rows ?? [],
                  undelivered: previous.get(project.projectId)?.undelivered ?? [],
                },
          );
          return { status: "ready", projects };
        });
      } catch (cause) {
        if (mine !== generation.current) return;
        // Keep the last good queue on screen rather than blanking it.
        setState((current) =>
          current.status === "ready" ? current : { status: "unavailable", reason: cause instanceof Error ? cause.message : String(cause) },
        );
      }
    },
    [rpc],
  );

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** Applies a change to one project's cards until the next read confirms it. */
  const patchProject = useCallback((projectId: string, patch: (project: DecisionProject) => DecisionProject) => {
    generation.current++;
    setState((current) =>
      current.status !== "ready"
        ? current
        : { status: "ready", projects: current.projects.map((project) => (project.projectId === projectId ? patch(project) : project)) },
    );
  }, []);

  const answer = useCallback(
    async (projectId: string, taskId: string, decision: DecisionAnswer) => {
      const result = await rpc.call("answerDecision", { projectId, taskId, answer: decision });
      if (!result.ok) throw new Error(result.error ?? "Opsdesk did not record the answer.");
      const delivery = result.delivery;
      // The answer is recorded either way. When the asker was not told, the
      // card turns into a "not delivered" notice instead of disappearing.
      patchProject(projectId, (project) => {
        const row = project.rows.find((candidate) => candidate.taskId === taskId);
        const rows = project.rows.filter((candidate) => candidate.taskId !== taskId);
        if (row === undefined || delivery === null || isSettledDelivery(delivery)) return { ...project, rows };
        const undelivered = [...project.undelivered.filter((u) => u.taskId !== taskId), toUndelivered(row, delivery)];
        return { ...project, rows, undelivered };
      });
      void refresh(true);
      return delivery;
    },
    [patchProject, refresh, rpc],
  );

  const retryDelivery = useCallback(
    async (projectId: string, taskId: string) => {
      const result = await rpc.call("retryDecisionDelivery", { projectId, taskId });
      if (!result.ok) throw new Error(result.error ?? "Opsdesk did not send the answer.");
      const delivery = result.delivery;
      patchProject(projectId, (project) => ({
        ...project,
        undelivered: isSettledDelivery(delivery)
          ? project.undelivered.filter((u) => u.taskId !== taskId)
          : project.undelivered.map((u) => (u.taskId === taskId && delivery !== null ? { ...toUndelivered(u, delivery), answer: u.answer } : u)),
      }));
      void refresh(true);
      return delivery;
    },
    [patchProject, refresh, rpc],
  );

  const acknowledgeDelivery = useCallback(
    async (projectId: string, taskId: string) => {
      const result = await rpc.call("acknowledgeDecisionDelivery", { projectId, taskId });
      if (!result.ok) throw new Error(result.error ?? "Opsdesk did not update the answer.");
      patchProject(projectId, (project) => ({ ...project, undelivered: project.undelivered.filter((u) => u.taskId !== taskId) }));
      void refresh(true);
    },
    [patchProject, refresh, rpc],
  );

  const rows = useMemo(() => (state.status === "ready" ? state.projects.flatMap((project) => project.rows) : []), [state]);
  const undelivered = state.status === "ready" ? state.projects.reduce((sum, project) => sum + project.undelivered.length, 0) : 0;
  return {
    state,
    count: rows.length + undelivered,
    overdue: rows.filter((row) => row.isOverdue && !row.hasDefaulted).length,
    refresh,
    answer,
    retryDelivery,
    acknowledgeDelivery,
  };
}
