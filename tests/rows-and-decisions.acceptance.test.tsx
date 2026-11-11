import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { DecisionRow, DecisionsResult, ThreadRun, UndeliveredAnswer, cursorSidebarRpcContract } from "../src/server";
import { sidebarViewSchema } from "../src/server";
import { DEFAULT_SIDEBAR_VIEW } from "../src/sidebar-view";

const MINUTE = 60_000;

function thread(id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id, title: id, titleFallback: null, projectId: "npi", parentThreadId: null,
    sectionId: null, originKind: null, originPluginId: null, providerId: "codex",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false,
    isArchived: false, environment: null, host: null,
    createdAt: Date.now() - 60 * MINUTE, updatedAt: Date.now() - MINUTE, lastReadAt: null, latestAttentionAt: 0,
    ...overrides,
  };
}

function decision(taskId: string, overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    taskId, key: `NM-${taskId}`, title: `Question ${taskId}?`, kind: "decision", summary: "Context for the question.",
    defaultPick: "Take option 1.", dueDate: "2026-11-16", isOverdue: false, hasDefaulted: false, parentKey: null, parentTitle: null,
    ...overrides,
  };
}

const providers = [
  { id: "codex", name: "Codex", logoUrl: "/api/v1/system/providers/codex/logo", available: true },
  { id: "claude-code", name: "Claude Code", logoUrl: "/api/v1/system/providers/claude-code/logo", available: true, strings: { iconTint: { light: "#D97757", dark: "#D97757" } } },
];

function mount(rpc: Partial<PluginRpcTestHandlers<typeof cursorSidebarRpcContract>>, threads: PluginSidebarThread[]) {
  const handlers = {
    // Updated grouping puts today's rows on screen without opening a project.
    sidebarView: () => ({ view: { ...DEFAULT_SIDEBAR_VIEW, groupBy: "updated" as const } }),
    setSidebarView: ({ view }: { view: unknown }) => ({ view: sidebarViewSchema.parse(view) }),
    botsList: () => ({ available: false, reason: "not installed", bots: [], threadBindings: [], personalProjectId: null, projectOwners: [] }),
    primaryHost: () => ({ hostId: "mini" }),
    listProjectIcons: () => ({ icons: [] }),
    listWorkspaces: () => ({ workspaces: [] }),
    listThreadSections: () => ({ sections: [] }),
    listThreadOrders: () => ({ orders: [] }),
    ...rpc,
  } as PluginRpcTestHandlers<typeof cursorSidebarRpcContract>;
  return loadPluginApp(() => import("../app")).then((app) =>
    renderSlot<PluginThreadListProps, typeof cursorSidebarRpcContract>(app.threadLists[0]!, {
      activeThreadId: null, activeProjectId: "npi", isCompactViewport: false, searchQuery: "", onNavigate: () => {},
      Original: () => null,
    }, {
      rpc: handlers,
      sidebarThreads: { projects: [{ id: "npi", name: "NPI Manager", isPersonal: false }], threads },
      providers: { status: "ready", providers: providers as never },
    }),
  );
}

test("rows name the model a thread runs on and how long a working turn has gone, never its branch", async () => {
  const started = Date.now() - (14 * 60 + 30) * MINUTE;
  const runs: Record<string, Omit<ThreadRun, "threadId">> = {
    "Desk": { model: "gpt-6.1-sol", modelLabel: "Sol 6.1", reasoningLevel: "high", turnStartedAt: null },
    "Worker": { model: "claude-opus-5-5", modelLabel: "Opus 5.5", reasoningLevel: "xhigh", turnStartedAt: started },
  };
  const slot = await mount({
    threadRuns: ({ threads }) => ({ runs: threads.map(({ threadId }) => ({ threadId, ...runs[threadId]! })) }),
  }, [
    thread("Desk", { environment: { id: "env", name: null, branchName: "bb/desk-branch-thr_123", workspaceDisplayKind: "other" } }),
    thread("Worker", { providerId: "claude-code", indicator: "runtime", indicatorLabel: "Thread is working" }),
  ]);

  const lines = () => Array.from(document.querySelectorAll(".cs-secondary-desktop"), (line) => line.textContent);
  await waitFor(() => expect(lines()).toEqual(expect.arrayContaining(["Sol 6.1 high", "Opus 5.5 xhigh"])));
  // The working row trades its age for the turn's running time.
  expect(screen.getByLabelText("Working for 14h").textContent).toBe("14h");
  expect(document.body.textContent).not.toContain("bb/desk-branch");
  // Each model line starts with its provider's mark, in the provider's tint.
  const workerLogo = document.querySelector<HTMLElement>('.cs-secondary-desktop [data-provider-logo="claude-code"]');
  expect(workerLogo?.style.getPropertyValue("--cs-logo-dark")).toBe("#D97757");
  expect(document.querySelector('.cs-secondary-desktop [data-provider-logo="codex"]')).not.toBeNull();
  // One batched read; only the working thread asks for its turn start.
  const calls = slot.inspection.rpcCalls.filter(({ method }) => method === "threadRuns");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.input).toEqual({
    threads: expect.arrayContaining([
      { threadId: "Desk", providerId: "codex", working: false },
      { threadId: "Worker", providerId: "claude-code", working: true },
    ]),
  });
  slot.lifecycle.unmount();
});

test("the Decisions chip opens Opsdesk's queue in the sidebar and answers through it", async () => {
  let rows = [
    decision("916", { isOverdue: true, hasDefaulted: true, dueDate: "2026-09-16" }),
    decision("2416", { kind: "approval", defaultPick: null, title: "Send one demo reset test?" }),
    decision("2426", { dueDate: "2026-11-17", title: "Apply payments to native orders only?" }),
  ];
  const answers: unknown[] = [];
  let readError: string | null = null;
  const queue = (): DecisionsResult => ({
    available: true, reason: null,
    projects: [{ projectId: "npi", name: "npi-manager", error: readError, rows: readError === null ? rows : [], undelivered: [] }],
  });
  const slot = await mount({
    threadRuns: ({ threads }) => ({ runs: threads.map(({ threadId }) => ({ threadId, model: null, modelLabel: null, reasoningLevel: null, turnStartedAt: null })) }),
    decisions: () => queue(),
    answerDecision: (input) => {
      answers.push(input);
      rows = rows.filter((row) => row.taskId !== input.taskId);
      return { ok: true, error: null, delivery: { outcome: "delivered", threadId: "thr_asker", detail: null } };
    },
  }, [thread("Anything")]);

  // A decision that already went ahead with its default is not overdue.
  const chip = await screen.findByRole("button", { name: "Decisions: 3 waiting on you" });
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(chip);
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  const list = await screen.findByText("3 waiting · 1 approval · 1 defaulted");
  const panel = list.closest("[role=tabpanel]") as HTMLElement;
  expect(within(panel).getByText("Defaulted Sep 16")).toBeTruthy();
  expect(within(panel).getByRole("link", { name: "NM-916" }).getAttribute("href")).toBe("/plugins/tasks/tasks/task/NM-916");

  // A read Tasks rejects keeps the cards and the count instead of emptying them.
  readError = "task-list data changed after this cursor was issued";
  fireEvent.click(within(panel).getByRole("button", { name: "Refresh decisions" }));
  await within(panel).findByText("Couldn’t read npi-manager just now; showing the last list. It retries on its own.");
  expect(within(panel).getByText("Question 916?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Decisions: 3 waiting on you" })).toBeTruthy();
  readError = null;

  // The defaulted decision offers Dismiss in place of Accept default; the
  // decision still waiting keeps Accept default.
  expect(within(panel).getAllByRole("button", { name: "Accept default" })).toHaveLength(1);
  fireEvent.click(within(panel).getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(within(panel).queryByText("Question 916?")).toBeNull());
  fireEvent.click(within(panel).getByRole("button", { name: "Accept default" }));
  await waitFor(() => expect(within(panel).queryByText("Apply payments to native orders only?")).toBeNull());
  expect(answers).toEqual([
    { projectId: "npi", taskId: "916", answer: { kind: "dismiss" } },
    { projectId: "npi", taskId: "2426", answer: { kind: "accept-default" } },
  ]);

  fireEvent.click(within(panel).getByRole("button", { name: "Decline…" }));
  fireEvent.change(within(panel).getByRole("textbox"), { target: { value: "Not until SMTP is verified" } });
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Decline" })); });
  await waitFor(() => expect(within(panel).getByText("Nothing is waiting on you")).toBeTruthy());
  expect(answers.at(-1)).toEqual({ projectId: "npi", taskId: "2416", answer: { kind: "decline", note: "Not until SMTP is verified" } });

  // Active and Decisions each replace the list, so turning one on turns the other off.
  fireEvent.click(screen.getByRole("button", { name: /^Active:/ }));
  expect(screen.getByRole("button", { name: /^Decisions:/ }).getAttribute("aria-pressed")).toBe("false");
  slot.lifecycle.unmount();
});

const noRuns = ({ threads }: { threads: { threadId: string }[] }) => ({
  runs: threads.map(({ threadId }) => ({ threadId, model: null, modelLabel: null, reasoningLevel: null, turnStartedAt: null })),
});

test("an answer the asking thread was not told stays as a Not delivered card until a retry delivers it", async () => {
  let rows = [decision("2469", { kind: "approval", defaultPick: null, title: "Apply SL-0 allocation migration to production?" })];
  let undelivered: UndeliveredAnswer[] = [];
  let sendWorks = false;
  const calls: { method: string; input: unknown }[] = [];
  const failed = { outcome: "failed", threadId: "thr_asker", detail: "Sending the answer to thr_asker failed: thread busy" };
  const slot = await mount({
    threadRuns: noRuns,
    decisions: () => ({ available: true, reason: null, projects: [{ projectId: "npi", name: "npi-manager", error: null, rows, undelivered }] }),
    answerDecision: (input) => {
      calls.push({ method: "answerDecision", input });
      rows = [];
      undelivered = [{ taskId: "2469", key: "NM-2469", title: "Apply SL-0 allocation migration to production?", answer: "**Peter approved.**", outcome: "failed", threadId: "thr_asker", detail: failed.detail }];
      return { ok: true, error: null, delivery: failed };
    },
    retryDecisionDelivery: (input) => {
      calls.push({ method: "retryDecisionDelivery", input });
      if (!sendWorks) return { ok: true, error: null, delivery: failed };
      undelivered = [];
      return { ok: true, error: null, delivery: { outcome: "delivered", threadId: "thr_asker", detail: null } };
    },
  }, [thread("Anything")]);

  fireEvent.click(await screen.findByRole("button", { name: "Decisions: 1 waiting on you" }));
  const panel = (await screen.findByText("1 waiting · 1 approval")).closest("[role=tabpanel]") as HTMLElement;
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Approve" })); });

  // The approval is recorded, but the card does not vanish: it says the thread was not told.
  await within(panel).findByText("Not delivered");
  expect(within(panel).getByText("Your answer is recorded, but sending it to thr_asker hit an error. It may still have arrived; retrying can send it twice.")).toBeTruthy();
  await within(panel).findByText("1 not delivered");
  expect(screen.getByRole("button", { name: "Decisions: 1 waiting on you" })).toBeTruthy();
  expect(within(panel).queryByRole("button", { name: "Approve" })).toBeNull();

  // A retry that fails again keeps the card; one that works clears it.
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Retry" })); });
  expect(within(panel).getByText("Not delivered")).toBeTruthy();
  sendWorks = true;
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Retry" })); });
  await waitFor(() => expect(within(panel).queryByText("Not delivered")).toBeNull());
  await within(panel).findByText("Nothing is waiting on you");

  // One answer write; the retries only ask Opsdesk to send.
  expect(calls.map((call) => call.method)).toEqual(["answerDecision", "retryDecisionDelivery", "retryDecisionDelivery"]);
  expect(calls[1]!.input).toEqual({ projectId: "npi", taskId: "2469" });
  slot.lifecycle.unmount();
});

test("a missing or interrupted delivery from Opsdesk's list is shown, and letting one go clears it", async () => {
  let undelivered: UndeliveredAnswer[] = [
    { taskId: "2463", key: "NM-2463", title: "Stop two orphaned dev servers?", answer: "**Peter approved.**", outcome: "no-asker", threadId: null, detail: null },
    { taskId: "2468", key: "NM-2468", title: "Accept the MW-3 design?", answer: "**Peter approved.**", outcome: "interrupted", threadId: "thr_x", detail: null },
    { taskId: "2471", key: "NM-2471", title: "Run the backfill?", answer: "**Peter approved.**", outcome: "not-sent", threadId: "thr_y", detail: "Opsdesk could not re-read the task before sending, so nothing was sent: HTTP 503" },
  ];
  const acknowledged: unknown[] = [];
  const slot = await mount({
    threadRuns: noRuns,
    decisions: () => ({ available: true, reason: null, projects: [{ projectId: "npi", name: "npi-manager", error: null, rows: [], undelivered }] }),
    acknowledgeDecisionDelivery: (input) => {
      acknowledged.push(input);
      undelivered = undelivered.filter((u) => u.taskId !== input.taskId);
      return { ok: true, error: null };
    },
  }, [thread("Anything")]);

  fireEvent.click(await screen.findByRole("button", { name: "Decisions: 3 waiting on you" }));
  const panel = (await screen.findByText("3 not delivered")).closest("[role=tabpanel]") as HTMLElement;
  expect(within(panel).getByText("Your answer is recorded, but the task names no asking thread, so nobody was told.")).toBeTruthy();
  expect(within(panel).getByText(/sending it was cut off\. The thread may already have it; retrying can send it twice\./)).toBeTruthy();
  const notSent = within(panel).getByText("Your answer is recorded, but Opsdesk could not confirm the task just before sending, so nothing was sent.");
  expect(notSent.getAttribute("title")).toMatch(/HTTP 503/);

  const card = within(panel).getByText("Stop two orphaned dev servers?").closest("li") as HTMLElement;
  await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Let go" })); });
  await waitFor(() => expect(within(panel).queryByText("Stop two orphaned dev servers?")).toBeNull());
  expect(acknowledged).toEqual([{ projectId: "npi", taskId: "2463" }]);
  expect(within(panel).getByText("2 not delivered")).toBeTruthy();
  slot.lifecycle.unmount();
});

test("an answer Opsdesk could not record keeps the card and the exact typed note for a retry", async () => {
  let rows = [decision("2470", { kind: "approval", defaultPick: null, title: "Send the update?" })];
  const answers: unknown[] = [];
  let fail = true;
  const slot = await mount({
    threadRuns: noRuns,
    decisions: () => ({ available: true, reason: null, projects: [{ projectId: "npi", name: "npi-manager", error: null, rows, undelivered: [] }] }),
    answerDecision: (input) => {
      answers.push(input);
      if (fail) return { ok: false, error: "Your answer is on NM-2470, but closing the task failed, so the asker has not been told. Try again; the answer will not be written twice.", delivery: null };
      rows = [];
      return { ok: true, error: null, delivery: { outcome: "delivered", threadId: "thr_a", detail: null } };
    },
  }, [thread("Anything")]);

  fireEvent.click(await screen.findByRole("button", { name: "Decisions: 1 waiting on you" }));
  const panel = (await screen.findByText("1 waiting · 1 approval")).closest("[role=tabpanel]") as HTMLElement;
  fireEvent.click(within(panel).getByRole("button", { name: "Decline…" }));
  const note = "Not yet:  drop the pricing line first.";
  fireEvent.change(within(panel).getByRole("textbox"), { target: { value: note } });
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Decline" })); });

  await within(panel).findByText(/closing the task failed/);
  expect((within(panel).getByRole("textbox") as HTMLTextAreaElement).value).toBe(note);
  fail = false;
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Decline" })); });
  await within(panel).findByText("Nothing is waiting on you");
  expect(answers).toEqual([
    { projectId: "npi", taskId: "2470", answer: { kind: "decline", note } },
    { projectId: "npi", taskId: "2470", answer: { kind: "decline", note } },
  ]);
  slot.lifecycle.unmount();
});
