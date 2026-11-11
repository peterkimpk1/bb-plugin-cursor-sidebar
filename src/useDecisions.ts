import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { DecisionAnswer, DecisionProject, cursorSidebarRpcContract } from "./server";

/** Opsdesk publishes on its own channel, which this plugin cannot hear, so the queue polls. */
const POLL_MS = 2 * 60_000;

export type DecisionsState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string | null }
  | { status: "ready"; projects: DecisionProject[] };

export interface Decisions {
  state: DecisionsState;
  /** Open decisions and approvals across every project. */
  count: number;
  /** Past due and still waiting; a decision that went ahead with its default is not. */
  overdue: number;
  /** `fresh` skips the server's shared read, e.g. when the list opens. */
  refresh: (fresh?: boolean) => Promise<void>;
  /** Records the answer through Opsdesk; throws its error so the card can show it. */
  answer: (projectId: string, taskId: string, answer: DecisionAnswer) => Promise<void>;
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
            project.error === null ? project : { ...project, rows: previous.get(project.projectId)?.rows ?? [] },
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

  const answer = useCallback(
    async (projectId: string, taskId: string, decision: DecisionAnswer) => {
      const result = await rpc.call("answerDecision", { projectId, taskId, answer: decision });
      if (!result.ok) throw new Error(result.error ?? "Opsdesk did not record the answer.");
      generation.current++;
      setState((current) =>
        current.status !== "ready"
          ? current
          : {
              status: "ready",
              projects: current.projects.map((project) =>
                project.projectId === projectId ? { ...project, rows: project.rows.filter((row) => row.taskId !== taskId) } : project,
              ),
            },
      );
      void refresh(true);
    },
    [refresh, rpc],
  );

  const rows = useMemo(() => (state.status === "ready" ? state.projects.flatMap((project) => project.rows) : []), [state]);
  return { state, count: rows.length, overdue: rows.filter((row) => row.isOverdue && !row.hasDefaulted).length, refresh, answer };
}
