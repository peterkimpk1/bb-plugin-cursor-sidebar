import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, cursorSidebarRpcContract } from "../src/server";
import { sidebarViewSchema } from "../src/server";
import { DEFAULT_SIDEBAR_VIEW } from "../src/sidebar-view";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RUNNING = { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 };

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

const bots: BotsListResult = {
  available: true, reason: null, personalProjectId: "personal", projectOwners: [],
  bots: [{ id: "chief", name: "Chief", role: "Chief of staff" }],
  threadBindings: [{ botId: "chief", threadId: "Chief desk" }],
};

function mount(app: Awaited<ReturnType<typeof loadPluginApp>>, threads: PluginSidebarThread[]) {
  const rpc = {
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
  return renderSlot<PluginThreadListProps, Pick<typeof cursorSidebarRpcContract, keyof typeof rpc>>(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: "npi", isCompactViewport: false, searchQuery: "", onNavigate: () => {},
    Original: () => null,
  }, {
    rpc,
    sidebarThreads: {
      projects: [
        { id: "npi", name: "NPI Manager", isPersonal: false },
        { id: "personal", name: "Personal", isPersonal: true },
      ],
      threads,
    },
  });
}

const panel = () => screen.getByRole("tabpanel");
const ids = (scope: ParentNode, selector = "[data-thread-row-id]") =>
  Array.from(scope.querySelectorAll(selector), (node) => node.getAttribute("data-thread-row-id"));

test("Active lists finished-unread threads under Unread, marks them read, and a kind chip shows one kind alone", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const slot = mount(app, [
    thread("Worker", { activity: RUNNING, indicator: "background-agent", updatedAt: now - MINUTE }),
    thread("Done while away", { isUnread: true, indicator: "unread-success", updatedAt: now - 2 * MINUTE }),
    thread("Also done", { isUnread: true, indicator: "unread-success", updatedAt: now - 3 * MINUTE }),
    thread("Broke", { isUnread: true, indicator: "unread-error", updatedAt: now - 4 * MINUTE }),
    thread("Read and quiet", { updatedAt: now - MINUTE }),
  ]);
  const chip = () => screen.getByRole("button", { name: /^Active:/ });
  await waitFor(() => expect(chip().getAttribute("aria-label")).toBe("Active: 4 threads"));
  fireEvent.click(chip());
  await waitFor(() =>
    expect(Array.from(panel().querySelectorAll("[data-active-kind]"), (node) => node.getAttribute("aria-label"))).toEqual([
      "Working", "Failed", "Unread",
    ]),
  );
  expect(ids(panel(), '[data-active-kind="unread"] [data-thread-row-id]')).toEqual(["Done while away", "Also done"]);
  expect(panel().querySelector('[data-thread-row-id="Read and quiet"]')).toBeNull();

  // The chips name each kind with its count; one shows that kind alone, again shows all.
  const kindChip = (kind: string) => panel().querySelector(`[data-kind-chip="${kind}"]`) as HTMLButtonElement;
  expect(Array.from(panel().querySelectorAll("[data-kind-chip]"), (node) => node.textContent)).toEqual(["Working1", "Failed1", "Unread2"]);
  fireEvent.click(kindChip("unread"));
  expect(kindChip("unread").getAttribute("aria-pressed")).toBe("true");
  expect(ids(panel())).toEqual(["Done while away", "Also done"]);
  fireEvent.click(kindChip("unread"));
  expect(ids(panel())).toEqual(["Worker", "Broke", "Done while away", "Also done"]);

  // Mark all read marks exactly the Unread rows.
  fireEvent.click(within(panel().querySelector('[data-active-kind="unread"]') as HTMLElement).getByRole("button", { name: "Mark all read" }));
  await waitFor(() => {
    const reads = slot.inspection.sidebarActionCalls.filter((call) => /read/i.test(call.method));
    expect(reads.map((call) => call.threadId).sort()).toEqual(["Also done", "Done while away"]);
  });
  slot.lifecycle.unmount();
});

test("Find matches any thread by title, task key, parent, bot or project, groups by state, and Escape returns the list", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const now = Date.now();
  const slot = mount(app, [
    thread("Chief desk", { title: "Chief desk", updatedAt: now - 2 * HOUR }),
    thread("Receiving", { title: "Redesign Receiving and item search (NM-2813)", parentThreadId: "Chief desk", activity: RUNNING, updatedAt: now - MINUTE }),
    thread("Receiving v1", { title: "Receiving prototype revision 1 (NM-2813)", updatedAt: now - 30 * HOUR }),
    thread("Old receiving", { title: "Receiving audit (NM-2813)", isArchived: true, updatedAt: now - HOUR }),
    thread("Unrelated", { title: "Clover heartbeat sync", updatedAt: now - HOUR }),
  ]);
  fireEvent.click(await screen.findByRole("tab", { name: "Threads" }));
  const box = screen.getByRole("searchbox", { name: "Find a thread" }) as HTMLInputElement;

  // "/" from outside a text field focuses it.
  act(() => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })); });
  expect(document.activeElement).toBe(box);

  fireEvent.change(box, { target: { value: "nm-2813" } });
  await waitFor(() => expect(panel().querySelector("[data-search-view]")).not.toBeNull());
  // Active matches first under their own kind, quiet ones under Earlier; archived ones never.
  expect(ids(panel(), '[data-active-kind="working"] [data-thread-row-id]')).toEqual(["Receiving"]);
  expect(ids(panel(), '[data-active-kind="idle"] [data-thread-row-id]')).toEqual(["Receiving v1"]);
  expect(panel().querySelector('[data-thread-row-id="Old receiving"]')).toBeNull();
  expect(panel().querySelector('[data-thread-row-id="Unrelated"]')).toBeNull();
  // Each row says where it lives.
  const info = (id: string) => panel().querySelector(`[data-thread-row-id="${id}"] .cs-thread-info`)?.getAttribute("aria-label");
  expect(info("Receiving")).toBe("Chief · NPI Manager · ↳ Chief desk");

  // Every word must match, across the row's words: here the bot and a title word.
  fireEvent.change(box, { target: { value: "chief redesign" } });
  await waitFor(() => expect(ids(panel())).toEqual(["Receiving"]));
  // The parent's title finds its child too.
  fireEvent.change(box, { target: { value: "chief desk" } });
  await waitFor(() => expect(ids(panel())).toEqual(["Receiving", "Chief desk"]));

  fireEvent.change(box, { target: { value: "no such words" } });
  await waitFor(() => expect(panel().querySelector("[data-search-empty]")).not.toBeNull());

  fireEvent.keyDown(box, { key: "Escape" });
  expect(box.value).toBe("");
  await waitFor(() => expect(panel().querySelector("[data-search-view]")).toBeNull());
  expect(panel().querySelector('[data-thread-row-id="Unrelated"]')).not.toBeNull();
  slot.lifecycle.unmount();
});
