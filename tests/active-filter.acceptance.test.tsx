import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, cursorSidebarRpcContract } from "../src/server";
import { sidebarViewSchema } from "../src/server";
import { DEFAULT_SIDEBAR_VIEW } from "../src/sidebar-view";
import { machineKind } from "../src/active";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function thread(id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id, title: id, titleFallback: null, projectId: "npi", parentThreadId: null,
    sectionId: null, originKind: null, originPluginId: null, providerId: "codex",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false,
    isArchived: false, environment: null, host: null,
    createdAt: Date.now() - 10 * HOUR, updatedAt: Date.now() - 6 * HOUR, lastReadAt: null, latestAttentionAt: 0,
    ...overrides,
  };
}

const RUNNING = { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 };

const bots: BotsListResult = {
  available: true, reason: null, personalProjectId: "personal", projectOwners: [],
  bots: [{ id: "builder", name: "Builder", role: "Implementation" }],
  threadBindings: [{ botId: "builder", threadId: "Builder desk" }],
};

function rpcFor() {
  return {
    // Updated grouping, so the folded parents are on screen without opening a project.
    sidebarView: () => ({ view: { ...DEFAULT_SIDEBAR_VIEW, groupBy: "updated" as const } }),
    setSidebarView: ({ view }) => ({ view: sidebarViewSchema.parse(view) }),
    botsList: () => bots,
    botsAvatars: () => ({ avatars: {} }),
    botsDeskStatus: () => ({ available: true, bots: [] }),
    primaryHost: () => ({ hostId: "mini" }),
    listProjectIcons: () => ({ icons: [] }),
    listWorkspaces: () => ({ workspaces: [] }),
    listThreadSections: () => ({ sections: [] }),
    listThreadOrders: () => ({ orders: [] }),
  } satisfies Partial<PluginRpcTestHandlers<typeof cursorSidebarRpcContract>>;
}

const projects = [
  { id: "npi", name: "NPI Manager", isPersonal: false },
  { id: "personal", name: "Personal", isPersonal: true },
];

function mount(app: Awaited<ReturnType<typeof loadPluginApp>>, threads: PluginSidebarThread[]) {
  const rpc = rpcFor();
  return renderSlot<PluginThreadListProps, Pick<typeof cursorSidebarRpcContract, keyof typeof rpc>>(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: "npi", isCompactViewport: false, searchQuery: "", onNavigate: () => {},
    Original: () => null,
  }, { rpc, sidebarThreads: { projects, threads } });
}

test("Active lists every thread that matters at any depth, flat, on both tabs, and is remembered per window", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const threads = [
    // A bot desk two levels above the work: Builder owns the whole subtree.
    thread("Builder desk", { updatedAt: now - 5 * HOUR }),
    // It asks while its own background agent keeps running: the question still wins.
    thread("Asks a question", { parentThreadId: "Builder desk", activity: RUNNING, hasPendingInteraction: true, indicator: "waiting-for-input", indicatorLabel: "Thread needs user input", updatedAt: now - 4 * HOUR }),
    thread("Deep worker", { parentThreadId: "Asks a question", activity: RUNNING, indicator: "background-agent", updatedAt: now - 3 * HOUR }),
    thread("Plain root", { updatedAt: now - 7 * HOUR }),
    thread("Broke unread", { parentThreadId: "Plain root", indicator: "unread-error", isUnread: true, updatedAt: now - 8 * HOUR }),
    thread("Broke but read", { indicator: "unread-error", isUnread: false, updatedAt: now - 8 * HOUR }),
    thread("Touched an hour ago", { projectId: "personal", updatedAt: now - HOUR }),
    thread("Touched just now", { updatedAt: now - MINUTE }),
    thread("Stale", { updatedAt: now - 3 * HOUR }),
    thread("Archived but fresh", { isArchived: true, updatedAt: now - MINUTE }),
  ];
  let slot = mount(app, threads);

  const chip = () => screen.getByRole("button", { name: /^Active:/ });
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Active: 3 threads, 1 needs you"));
  expect(chip().getAttribute("aria-pressed")).toBe("false");

  // Outside the Active view the folded parents carry their children's attention.
  const panel = () => screen.getByRole("tabpanel");
  const row = (id: string) => panel().querySelector(`[data-thread-row-id="${id}"]`) as HTMLElement | null;
  await waitFor(() => expect(row("Builder desk")).not.toBeNull());
  expect(row("Asks a question")).toBeNull();
  const deskBadge = row("Builder desk")!.querySelector(".cs-folded-attention");
  expect(deskBadge?.textContent).toBe("1");
  expect(deskBadge?.getAttribute("aria-label")).toBe("1 folded child thread needs you");
  expect(within(row("Builder desk")!).getByRole("img", { name: "Thread needs user input" })).toBeTruthy();
  const rootBadge = row("Plain root")!.querySelector(".cs-folded-attention");
  expect(rootBadge?.classList.contains("cs-failed-count")).toBe(true);
  expect(rootBadge?.getAttribute("aria-label")).toBe("1 folded child thread has failed");
  // Unfolding hands the count to the children's own rows.
  fireEvent.click(within(row("Plain root")!).getByRole("button", { name: "Show 1 child thread" }));
  await waitFor(() => expect(row("Broke unread")).not.toBeNull());
  expect(row("Plain root")!.querySelector(".cs-folded-attention")).toBeNull();

  fireEvent.click(chip());
  expect(chip().getAttribute("aria-pressed")).toBe("true");
  const activeIds = () =>
    Array.from(panel().querySelectorAll("[data-active-view] [data-thread-row-id]"), (node) => node.getAttribute("data-thread-row-id"));
  const expected = ["Asks a question", "Deep worker", "Broke unread"];
  await waitFor(() => expect(activeIds()).toEqual(expected));
  expect(Array.from(panel().querySelectorAll("[data-active-kind]"), (node) => node.getAttribute("aria-label"))).toEqual([
    "Needs you", "Working", "Failed",
  ]);
  // Flat: no child toggles, no rails, and each row names its bot, project and parent.
  expect(within(panel()).queryAllByRole("button", { name: /child thread/ })).toHaveLength(0);
  const info = (id: string) => row(id)!.querySelector(".cs-thread-info")?.getAttribute("aria-label");
  expect(info("Asks a question")).toBe("Builder · NPI Manager · ↳ Builder desk");
  expect(info("Deep worker")).toBe("Builder · NPI Manager · ↳ Asks a question");
  expect(info("Broke unread")).toBe("NPI Manager · ↳ Plain root");
  expect(row("Touched an hour ago")).toBeNull();
  expect(row("Touched just now")).toBeNull();
  // A row speaks for itself here, and a raised hand outranks its own or its child's spinner.
  expect(within(row("Asks a question")!).getByRole("img", { name: "Thread needs user input" })).toBeTruthy();

  // The rows are the tree's own rows: open and archive go through the host.
  fireEvent.click(within(row("Deep worker")!).getByRole("link", { name: "Deep worker" }));
  fireEvent.click(within(row("Broke unread")!).getByRole("button", { name: "Archive" }));
  await waitFor(() =>
    expect(slot.inspection.sidebarActionCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "open", threadId: "Deep worker" }),
        expect.objectContaining({ method: "archive", threadId: "Broke unread" }),
      ]),
    ),
  );

  // The same flat list on the Bots tab, with the filter still on.
  fireEvent.click(screen.getByRole("tab", { name: /^Bots/ }));
  expect(chip().getAttribute("aria-pressed")).toBe("true");
  expect(panel().querySelector("[data-bot-row]")).toBeNull();
  expect(activeIds()).toEqual(expected);

  // A new mount in the same window comes back filtered, on the same tab.
  slot.lifecycle.unmount();
  slot = mount(app, threads);
  await waitFor(() => expect(chip().getAttribute("aria-pressed")).toBe("true"));
  expect(screen.getByRole("tab", { name: /^Bots/ }).getAttribute("aria-selected")).toBe("true");
  await waitFor(() => expect(activeIds()).toEqual(expected));

  // Off returns the tab's own list.
  fireEvent.click(chip());
  await waitFor(() => expect(panel().querySelector("[data-bot-row]")).not.toBeNull());
  expect(panel().querySelector("[data-active-view]")).toBeNull();
  slot.lifecycle.unmount();
});

test("Active shows an empty state when nothing matters right now", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = mount(app, [thread("Old and quiet"), thread("Recent idle pin", { isPinned: true, updatedAt: Date.now() }), thread("Read failure", { indicator: "unread-error" })]);
  await waitFor(() => expect(screen.getByRole("button", { name: /^Active:/ }).getAttribute("aria-label")).toBe("Active: 0 threads"));
  fireEvent.click(screen.getByRole("button", { name: /^Active:/ }));
  expect(await screen.findByText("All quiet")).toBeTruthy();
  expect(screen.getByRole("tabpanel").querySelector("[data-thread-row-id]")).toBeNull();
  slot.lifecycle.unmount();
});

test("Active keeps related workers flat without holder rows or collapse controls", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const slot = mount(app, [
    thread("Desk"),
    thread("Parent", { parentThreadId: "Desk", activity: RUNNING, updatedAt: now - 2 * MINUTE }),
    thread("Sibling", { parentThreadId: "Desk", activity: RUNNING, updatedAt: now - 3 * MINUTE }),
    thread("Child", { parentThreadId: "Parent", activity: RUNNING, updatedAt: now - MINUTE }),
    thread("Pinned parent", { isPinned: true }),
    thread("Quiet unpinned child", { parentThreadId: "Pinned parent" }),
    thread("Pinned child", { activity: RUNNING, parentThreadId: "Pinned parent", isPinned: true, updatedAt: now - MINUTE }),
    thread("Active unpinned child", { parentThreadId: "Pinned parent", activity: RUNNING, updatedAt: now }),
  ]);
  fireEvent.click(screen.getByRole("button", { name: /^Active:/ }));
  const panel = screen.getByRole("tabpanel");
  const ids = (kind: string) => Array.from(panel.querySelectorAll(`[data-active-kind="${kind}"] [data-thread-row-id]`), (row) => row.getAttribute("data-thread-row-id"));
  await waitFor(() => expect(ids("pinned")).toEqual(["Pinned child"]));
  expect(ids("working")).toEqual(["Active unpinned child", "Child", "Parent", "Sibling"]);
  // An idle pin has no row, even when a pinned child of it is running.
  expect(panel.querySelector('[data-thread-row-id="Pinned parent"]')).toBeNull();
  expect(panel.querySelector('[data-thread-row-id="Desk"]')).toBeNull();
  expect(panel.querySelector('[data-thread-row-id="Quiet unpinned child"]')).toBeNull();
  expect(within(panel).queryAllByRole("button", { name: /child thread|collapse|expand/i })).toHaveLength(0);
  expect(panel.querySelector(".cs-folded-attention")).toBeNull();
  slot.lifecycle.unmount();
});

test("Pinned gives each active pinned thread its own row, whatever its family", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const slot = mount(app, [
    // An unpinned desk running pinned workers, as Chief desk does.
    thread("Desk", { activity: RUNNING, updatedAt: now - 3 * MINUTE }),
    thread("First pinned worker", { activity: RUNNING, parentThreadId: "Desk", isPinned: true, updatedAt: now }),
    thread("Second pinned worker", { activity: RUNNING, parentThreadId: "Desk", isPinned: true, updatedAt: now - MINUTE }),
    thread("Pinned grandchild", { activity: RUNNING, parentThreadId: "First pinned worker", isPinned: true, updatedAt: now - MINUTE }),
    thread("Idle pinned worker", { parentThreadId: "Desk", isPinned: true, updatedAt: now }),
    thread("Independent pin", { activity: RUNNING, isPinned: true }),
  ]);
  const chip = () => screen.getByRole("button", { name: /^Active:/ });
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Active: 5 threads"));
  fireEvent.click(chip());
  const panel = screen.getByRole("tabpanel");
  const ids = (kind: string) => Array.from(panel.querySelectorAll(`[data-active-kind="${kind}"] [data-thread-row-id]`), (row) => row.getAttribute("data-thread-row-id"));
  await waitFor(() => expect(ids("pinned")).toEqual([
    "First pinned worker", "Pinned grandchild", "Second pinned worker", "Independent pin",
  ]));
  // The unpinned desk stays where its own state puts it, as one plain row.
  expect(ids("working")).toEqual(["Desk"]);
  expect(panel.querySelector('[data-thread-row-id="Idle pinned worker"]')).toBeNull();
  expect(within(panel).queryAllByRole("button", { name: /child thread|collapse|expand/i })).toHaveLength(0);
  // Each pinned row names its own parent and keeps its own status.
  const row = (id: string) => panel.querySelector(`[data-thread-row-id="${id}"]`) as HTMLElement;
  expect(row("First pinned worker").querySelector(".cs-thread-info")?.getAttribute("aria-label")).toBe("NPI Manager · ↳ Desk");
  expect(row("Pinned grandchild").querySelector(".cs-thread-info")?.getAttribute("aria-label")).toBe("NPI Manager · ↳ First pinned worker");
  expect(row("Desk").querySelector(".cs-thread-info")?.getAttribute("aria-label")).toBe("NPI Manager");
  // Opening a pinned row opens that thread, and its pin unpins only that thread.
  fireEvent.click(within(row("Second pinned worker")).getByRole("link", { name: "Second pinned worker" }));
  fireEvent.click(row("Second pinned worker").querySelector("[data-row-pin]") as HTMLButtonElement);
  await waitFor(() => {
    expect(slot.inspection.sidebarActionCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "open", threadId: "Second pinned worker" })]),
    );
    const calls = slot.inspection.sidebarActionCalls.filter((call) => /pin/i.test(call.method));
    expect(calls).toEqual([expect.objectContaining({ threadId: "Second pinned worker", pinned: false })]);
  });
  slot.lifecycle.unmount();
});

test("Active leaves idle pins out, even under a running parent", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = mount(app, [
    thread("Running coordinator", { activity: RUNNING }),
    thread("Idle saved child pin", { parentThreadId: "Running coordinator", isPinned: true }),
    thread("Idle coordinator"),
    thread("Recent idle saved child", { parentThreadId: "Idle coordinator", isPinned: true, updatedAt: Date.now() }),
  ]);
  await waitFor(() => expect(screen.getByRole("button", { name: /^Active:/ }).getAttribute("aria-label")).toBe("Active: 1 thread"));
  fireEvent.click(screen.getByRole("button", { name: /^Active:/ }));
  const panel = screen.getByRole("tabpanel");
  await waitFor(() => expect(panel.querySelector('[data-active-kind="working"]')).not.toBeNull());
  const ids = Array.from(panel.querySelectorAll('[data-thread-row-id]'), (row) => row.getAttribute("data-thread-row-id"));
  expect(ids).toEqual(["Running coordinator"]);
  expect(panel.querySelector('[data-active-kind="pinned"]')).toBeNull();
  slot.lifecycle.unmount();
});

test("Active keeps pinned threads on top, shows the pin on every row, pins the row itself, and names the machine", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const mini = { id: "mini", name: "Peter’s Mac Mini" } as PluginSidebarThread["host"];
  const threads = [
    thread("Desk", { updatedAt: now - 9 * HOUR }),
    // A stale idle pin is excluded from Active.
    thread("Pinned and quiet", { isPinned: true, updatedAt: now - 9 * HOUR }),
    // Pinned and asking: under Pinned, and still counted as needing you.
    thread("Pinned and asking", { isPinned: true, hasPendingInteraction: true, indicator: "waiting-for-input", updatedAt: now - 5 * HOUR }),
    thread("Child worker", { parentThreadId: "Desk", host: mini, activity: RUNNING, indicator: "background-agent", updatedAt: now - MINUTE }),
  ];
  const slot = mount(app, threads);
  const chip = () => screen.getByRole("button", { name: /^Active:/ });
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Active: 2 threads, 1 needs you"));
  fireEvent.click(chip());
  const panel = () => screen.getByRole("tabpanel");
  await waitFor(() =>
    expect(Array.from(panel().querySelectorAll("[data-active-kind]"), (node) => node.getAttribute("aria-label"))).toEqual([
      "Pinned", "Working",
    ]),
  );
  const pinned = panel().querySelector('[data-active-kind="pinned"]') as HTMLElement;
  expect(Array.from(pinned.querySelectorAll("[data-thread-row-id]"), (node) => node.getAttribute("data-thread-row-id"))).toEqual([
    "Pinned and asking",
  ]);
  const row = (id: string) => panel().querySelector(`[data-thread-row-id="${id}"]`) as HTMLElement;
  // The pin sits on the row at rest, pressed and filled when pinned.
  const pin = (id: string) => row(id).querySelector("[data-row-pin]") as HTMLButtonElement;
  expect(row("Pinned and quiet")).toBeNull();
  expect(pin("Pinned and asking").getAttribute("aria-pressed")).toBe("true");
  expect(pin("Pinned and asking").querySelector(".cs-pin-filled")).not.toBeNull();
  expect(pin("Child worker").getAttribute("aria-pressed")).toBe("false");
  expect(row("Child worker").querySelector("[data-thread-actions]")?.querySelector('[aria-label="Pin"]')).toBeNull();
  // The machine shows as its glyph; its name, without the owner's, moves to the hover text.
  const info = row("Child worker").querySelector(".cs-thread-info") as HTMLElement;
  expect(info.getAttribute("aria-label")).toBe("Mac Mini · NPI Manager · ↳ Desk");
  expect(info.querySelector('.cs-secondary-desktop [data-machine="mini"]')).not.toBeNull();
  expect(info.querySelector(".cs-secondary-desktop")?.textContent).toBe("NPI Manager · ↳ Desk");
  expect([machineKind("Mac Mini"), machineKind("MacBook Pro"), machineKind("build-box")]).toEqual(["mini", "laptop", null]);
  // The Working heading counts its threads per machine.
  const counts = panel().querySelector('[data-active-kind="working"] [data-machine-counts]') as HTMLElement;
  expect(counts.getAttribute("aria-label")).toBe("1 on Mac Mini");
  expect(counts.querySelector('[data-machine="mini"]')).not.toBeNull();
  expect(panel().querySelector('[data-active-kind="pinned"] [data-machine-counts]')).toBeNull();
  // Pinning a child pins that child, not the desk above it.
  fireEvent.click(pin("Child worker"));
  fireEvent.click(pin("Pinned and asking"));
  await waitFor(() => {
    const calls = slot.inspection.sidebarActionCalls.filter((call) => /pin/i.test(call.method));
    expect(calls).toEqual([
      expect.objectContaining({ threadId: "Child worker", pinned: true }),
      expect.objectContaining({ threadId: "Pinned and asking", pinned: false }),
    ]);
  });
  slot.lifecycle.unmount();
});

test("Clicking a machine in the Working heading fades the other machines' rows; clicking it again shows all", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const mini = { id: "mini", name: "Peter’s Mac Mini" } as PluginSidebarThread["host"];
  const mbp = { id: "mbp", name: "Peter’s MacBook Pro" } as PluginSidebarThread["host"];
  const working = { activity: RUNNING, indicator: "background-agent" as const };
  const threads = [
    thread("Mini one", { ...working, host: mini, updatedAt: now - MINUTE }),
    thread("Mini two", { ...working, host: mini, updatedAt: now - 2 * MINUTE }),
    thread("Laptop one", { ...working, host: mbp, updatedAt: now - 3 * MINUTE }),
  ];
  const slot = mount(app, threads);
  fireEvent.click(screen.getByRole("button", { name: /^Active:/ }));
  const panel = () => screen.getByRole("tabpanel");
  const count = (name: string) =>
    panel().querySelector(`[data-machine-count="${name}"]`) as HTMLButtonElement;
  await waitFor(() => expect(count("Mac Mini")).not.toBeNull());
  // Busiest machine first.
  expect(Array.from(panel().querySelectorAll("[data-machine-count]"), (node) => node.textContent)).toEqual(["2", "1"]);
  const dimmed = () =>
    Array.from(panel().querySelectorAll("[data-thread-row-id].cs-row-dimmed"), (node) => node.getAttribute("data-thread-row-id"));
  expect(dimmed()).toEqual([]);

  fireEvent.click(count("Mac Mini"));
  expect(count("Mac Mini").getAttribute("aria-pressed")).toBe("true");
  expect(dimmed()).toEqual(["Laptop one"]);

  // Another machine moves the focus.
  fireEvent.click(count("MacBook Pro"));
  expect(dimmed()).toEqual(["Mini one", "Mini two"]);

  // The same machine again shows all.
  fireEvent.click(count("MacBook Pro"));
  expect(count("MacBook Pro").getAttribute("aria-pressed")).toBe("false");
  expect(dimmed()).toEqual([]);
  slot.lifecycle.unmount();
});
