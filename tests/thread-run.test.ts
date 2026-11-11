import { describe, expect, test, vi } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { compactModelName, isRunningTurn, modelLine, workingForLabel } from "../src/thread-run";
import { createThreadRunReader } from "../src/thread-runs-reader";
import { createDecisionsBridge } from "../src/decisions-bridge";

const MINUTE = 60_000;

describe("row labels", () => {
  test("model names read the same way for every provider", () => {
    expect(compactModelName("Opus 5.5")).toBe("Opus 5.5");
    expect(compactModelName("GPT-6.1-Sol")).toBe("Sol 6.1");
    expect(compactModelName("GPT-6.1 Terra")).toBe("Terra 6.1");
    // Raw ids, when the catalog has no entry.
    expect(compactModelName("gpt-6.1-sol")).toBe("Sol 6.1");
    expect(compactModelName("claude-opus-5-5")).toBe("Opus 5.5");
    expect(compactModelName("claude-haiku-4-5-20251001")).toBe("Haiku 4.5");
    expect(compactModelName("zai/glm-4.7")).toBe("zai/glm-4.7");
  });

  test("the model line names the reasoning level unless it is off", () => {
    const run = { threadId: "t", model: "claude-opus-5-5", modelLabel: "Opus 5.5", reasoningLevel: "high", turnStartedAt: null };
    expect(modelLine(run)).toBe("Opus 5.5 high");
    expect(modelLine({ ...run, reasoningLevel: "none" })).toBe("Opus 5.5");
    expect(modelLine({ ...run, modelLabel: null })).toBe("claude-opus-5-5 high");
    expect(modelLine({ ...run, model: null, modelLabel: null })).toBeNull();
    expect(modelLine(null)).toBeNull();
    expect(modelLine(undefined)).toBeNull();
  });

  test("working time is as coarse as the age labels", () => {
    const now = 1_000 * MINUTE;
    expect(workingForLabel(now - 30_000, now)).toBe("<1m");
    expect(workingForLabel(now + 30_000, now)).toBe("<1m");
    expect(workingForLabel(now - 12 * MINUTE, now)).toBe("12m");
    expect(workingForLabel(now - 65 * MINUTE, now)).toBe("1h 5m");
    expect(workingForLabel(now - 120 * MINUTE, now)).toBe("2h");
    expect(workingForLabel(now - (14 * 60 + 30) * MINUTE, now)).toBe("14h");
  });

  test("only a running turn counts as working", () => {
    const base = {
      hasPendingInteraction: false,
      indicator: "none",
      activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    } as unknown as PluginSidebarThread;
    expect(isRunningTurn({ ...base, status: "active" } as PluginSidebarThread)).toBe(true);
    expect(isRunningTurn({ ...base, status: "starting" } as PluginSidebarThread)).toBe(true);
    expect(isRunningTurn({ ...base, indicator: "runtime" })).toBe(true);
    // Background work left running after the turn ended is not a turn.
    expect(isRunningTurn({ ...base, status: "idle", indicator: "background-agent" } as PluginSidebarThread)).toBe(false);
    // A turn blocked on you is waiting, not working.
    expect(isRunningTurn({ ...base, status: "active", hasPendingInteraction: true } as PluginSidebarThread)).toBe(false);
  });
});

type Sdk = BbPluginApi["sdk"];

describe("threadRuns", () => {
  test("reads each thread's latest model, and the turn start only for working threads", async () => {
    const options: Record<string, { model: string; reasoningLevel: string }> = {
      desk: { model: "gpt-6.1-sol", reasoningLevel: "high" },
      worker: { model: "claude-opus-5-5", reasoningLevel: "xhigh" },
    };
    const defaultExecutionOptions = vi.fn(async ({ threadId }: { threadId: string }) => {
      if (!(threadId in options)) throw new Error("gone");
      return { ...options[threadId]!, permissionMode: "full", serviceTier: "default" };
    });
    const list = vi.fn(async () => [{ createdAt: 42 }]);
    const models = vi.fn(async ({ providerId }: { providerId?: string }) => ({
      models: providerId === "codex" ? [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol" }] : [],
    }));
    const sdk = { threads: { defaultExecutionOptions, events: { list } }, providers: { models } } as unknown as Sdk;
    const read = createThreadRunReader(sdk);

    const runs = await read([
      { threadId: "desk", providerId: "codex", working: false },
      { threadId: "worker", providerId: "claude-code", working: true },
      { threadId: "deleted", providerId: "codex", working: true },
    ]);

    expect(runs).toEqual([
      { threadId: "desk", model: "gpt-6.1-sol", modelLabel: "Sol 6.1", reasoningLevel: "high", turnStartedAt: null },
      // Not in its catalog: the raw id is shortened the same way.
      { threadId: "worker", model: "claude-opus-5-5", modelLabel: "Opus 5.5", reasoningLevel: "xhigh", turnStartedAt: 42 },
      { threadId: "deleted", model: null, modelLabel: null, reasoningLevel: null, turnStartedAt: 42 },
    ]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith({ threadId: "worker", types: ["turn/started"], order: "desc", limit: "1" });
    await read([{ threadId: "desk", providerId: "codex", working: false }]);
    // One catalog read per provider, shared by every later call.
    expect(models).toHaveBeenCalledTimes(2);
  });
});

describe("decisions", () => {
  const row = (taskId: string) => ({
    taskId, key: `NM-${taskId}`, title: `Decide ${taskId}?`, kind: "decision", summary: "", defaultPick: "Yes",
    dueDate: "2026-11-16", isOverdue: false, hasDefaulted: false, parentKey: null, parentTitle: null, updatedAt: "2026-11-01T00:00:00Z",
  });

  function opsdesk(overrides: Record<string, (input: unknown) => unknown> = {}) {
    const handlers: Record<string, (input: unknown) => unknown> = {
      listProjects: () => ({
        projects: [
          { id: "npi", name: "npi-manager", hasTasksProject: true },
          { id: "hakanai", name: "hakanai", hasTasksProject: false },
          { id: "shop", name: "pure-shenandoah-shopify", hasTasksProject: true },
        ],
      }),
      getDecisions: (input) => {
        if ((input as { projectId: string }).projectId === "shop") throw new Error("Tasks is restarting");
        return { project: { id: "npi", name: "npi-manager" }, statusDetail: null, rows: [row("1"), row("2")], summary: { open: 2, approvals: 0, overdue: 0 } };
      },
      answerDecision: () => ({ ok: true, error: null }),
      ...overrides,
    };
    const callRpc = vi.fn(async ({ method, input, outputSchema }: { method: string; input: unknown; outputSchema: { parse: (value: unknown) => unknown } }) =>
      outputSchema.parse(await handlers[method]!(input)),
    );
    return { sdk: { plugins: { callRpc } } as unknown as Sdk, callRpc };
  }

  const decisionCalls = (callRpc: ReturnType<typeof opsdesk>["callRpc"]) =>
    callRpc.mock.calls.filter(([call]) => call.method === "getDecisions").length;

  test("retries a project read that Tasks rejects once, and shares a clean read", async () => {
    vi.useFakeTimers();
    try {
      let shopFailures = 1;
      const { sdk, callRpc } = opsdesk({
        getDecisions: (input) => {
          if ((input as { projectId: string }).projectId === "shop" && shopFailures-- > 0) {
            throw new Error("task-list data changed after this cursor was issued");
          }
          return { rows: [row((input as { projectId: string }).projectId)] };
        },
      });
      const bridge = createDecisionsBridge(sdk);
      const pending = bridge.list(false);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.projects.map((project) => [project.name, project.rows.map((entry) => entry.key), project.error])).toEqual([
        ["npi-manager", ["NM-npi"], null],
        ["pure-shenandoah-shopify", ["NM-shop"], null],
      ]);
      expect(decisionCalls(callRpc)).toBe(3);
      // Windows share one clean read until it goes stale; opening the list reads past it.
      await bridge.list(false);
      expect(decisionCalls(callRpc)).toBe(3);
      await bridge.list(true);
      expect(decisionCalls(callRpc)).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  test("names a project it still could not read, and reads again on the next poll", async () => {
    vi.useFakeTimers();
    try {
      const { sdk, callRpc } = opsdesk();
      const bridge = createDecisionsBridge(sdk);
      let pending = bridge.list(false);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.projects.map((project) => [project.name, project.rows.length, project.error])).toEqual([
        ["npi-manager", 2, null],
        ["pure-shenandoah-shopify", 0, "Tasks is restarting"],
      ]);
      expect(decisionCalls(callRpc)).toBe(4);
      pending = bridge.list(false);
      await vi.runAllTimersAsync();
      await pending;
      expect(decisionCalls(callRpc)).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });

  test("answers through Opsdesk and drops the shared read", async () => {
    const { sdk, callRpc } = opsdesk();
    const bridge = createDecisionsBridge(sdk);
    await bridge.list(false);
    const input = { projectId: "npi", taskId: "1", answer: { kind: "accept-default" as const } };
    // An Opsdesk that does not report delivery reads as nothing to show.
    expect(await bridge.answer(input)).toEqual({ ok: true, error: null, delivery: null });
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "opsdesk", method: "answerDecision", input }));
    await bridge.list(false);
    expect(callRpc.mock.calls.filter(([call]) => call.method === "listProjects")).toHaveLength(2);
  });

  test("passes Opsdesk's delivery report and undelivered answers through, and forwards retry and let-go", async () => {
    const undelivered = { taskId: "9", key: "NM-9", title: "Approve?", answer: "**Peter approved.**", outcome: "failed", threadId: "thr_a", detail: "busy", updatedAt: "2026-11-11T00:00:00Z" };
    const { sdk, callRpc } = opsdesk({
      listProjects: () => ({ projects: [{ id: "npi", name: "npi-manager", hasTasksProject: true }] }),
      getDecisions: () => ({ rows: [], undelivered: [undelivered], summary: { open: 0, approvals: 0, overdue: 0 } }),
      answerDecision: () => ({ ok: true, error: null, delivery: { outcome: "no-asker", threadId: null, detail: "No asker." } }),
      retryDecisionDelivery: () => ({ ok: true, error: null, delivery: { outcome: "delivered", threadId: "thr_a", detail: null } }),
      acknowledgeDecisionDelivery: () => ({ ok: true, error: null }),
    });
    const bridge = createDecisionsBridge(sdk);
    const listed = await bridge.list(true);
    expect(listed.projects[0]!.undelivered).toEqual([
      { taskId: "9", key: "NM-9", title: "Approve?", answer: "**Peter approved.**", outcome: "failed", threadId: "thr_a", detail: "busy" },
    ]);
    expect((await bridge.answer({ projectId: "npi", taskId: "9", answer: { kind: "approve", note: "" } })).delivery)
      .toEqual({ outcome: "no-asker", threadId: null, detail: "No asker." });
    expect((await bridge.retryDelivery({ projectId: "npi", taskId: "9" })).delivery?.outcome).toBe("delivered");
    expect(await bridge.acknowledgeDelivery({ projectId: "npi", taskId: "9" })).toEqual({ ok: true, error: null });
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "retryDecisionDelivery", input: { projectId: "npi", taskId: "9" } }));
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "acknowledgeDecisionDelivery", input: { projectId: "npi", taskId: "9" } }));
  });

  test("an Opsdesk without delivery tracking lists no undelivered answers", async () => {
    const { sdk } = opsdesk({ listProjects: () => ({ projects: [{ id: "npi", name: "npi-manager", hasTasksProject: true }] }) });
    expect((await createDecisionsBridge(sdk).list(true)).projects[0]!.undelivered).toEqual([]);
  });

  test("reports Opsdesk as unavailable instead of failing", async () => {
    const { sdk } = opsdesk({ listProjects: () => { throw new Error("plugin opsdesk is not running"); } });
    expect(await createDecisionsBridge(sdk).list(false)).toEqual({ available: false, reason: "plugin opsdesk is not running", projects: [] });
  });
});
