import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, cursorSidebarRpcContract } from "../src/server";
import { sidebarViewSchema } from "../src/server";
import { DEFAULT_SIDEBAR_VIEW } from "../src/sidebar-view";

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
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Active: 5 threads, 1 needs you"));
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
  const expected = ["Asks a question", "Deep worker", "Broke unread", "Touched just now", "Touched an hour ago"];
  await waitFor(() => expect(activeIds()).toEqual(expected));
  expect(Array.from(panel().querySelectorAll("[data-active-kind]"), (node) => node.getAttribute("aria-label"))).toEqual([
    "Needs you", "Working", "Failed", "Recent",
  ]);
  // Flat: no child toggles, no rails, and each row names its bot, parent and project.
  expect(within(panel()).queryAllByRole("button", { name: /child thread/ })).toHaveLength(0);
  const info = (id: string) => row(id)!.querySelector(".cs-thread-info")?.getAttribute("aria-label");
  expect(info("Asks a question")).toBe("Builder · ↳ Builder desk · NPI Manager");
  expect(info("Deep worker")).toBe("Builder · ↳ Asks a question · NPI Manager");
  expect(info("Broke unread")).toBe("↳ Plain root · NPI Manager");
  expect(info("Touched an hour ago")).toBe("Chats");
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
  const slot = mount(app, [thread("Old and quiet"), thread("Read failure", { indicator: "unread-error" })]);
  await waitFor(() => expect(screen.getByRole("button", { name: /^Active:/ }).getAttribute("aria-label")).toBe("Active: 0 threads"));
  fireEvent.click(screen.getByRole("button", { name: /^Active:/ }));
  expect(await screen.findByText("All quiet")).toBeTruthy();
  expect(screen.getByRole("tabpanel").querySelector("[data-thread-row-id]")).toBeNull();
  slot.lifecycle.unmount();
});
