import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, cursorSidebarRpcContract } from "../src/server";
import { sidebarViewSchema } from "../src/server";
import { DEFAULT_SIDEBAR_VIEW } from "../src/sidebar-view";
import { buildBotSection } from "../src/bots";
import { planPinWrites } from "../src/pin-scope";

const MINUTE = 60_000;

function thread(id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id, title: id, titleFallback: null, projectId: "npi", parentThreadId: null,
    sectionId: null, originKind: null, originPluginId: null, providerId: "codex",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false,
    isArchived: false, environment: null, host: null,
    createdAt: Date.now() - 60 * MINUTE, updatedAt: Date.now() - 30 * MINUTE, lastReadAt: null, latestAttentionAt: 0,
    ...overrides,
  };
}

const bots: BotsListResult = {
  available: true, reason: null, personalProjectId: "personal", projectOwners: [],
  bots: [{ id: "chief", name: "Chief", role: "Chief of staff" }],
  threadBindings: [{ botId: "chief", threadId: "Desk" }],
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
  return renderSlot<PluginThreadListProps, Pick<typeof cursorSidebarRpcContract, keyof typeof rpc>>(
    (app.threadLists[0])!,
    {
      activeThreadId: null, activeProjectId: "npi", isCompactViewport: false, searchQuery: "", onNavigate: () => {},
      Original: () => null,
    },
    {
      rpc,
      sidebarThreads: {
        projects: [
          { id: "npi", name: "NPI Manager", isPersonal: false },
          { id: "personal", name: "Personal", isPersonal: true },
        ],
        threads,
      },
    },
  );
}

// A desk with several workers, as Chief desk has: two are pinned, one has a sub-thread.
const deskFamily = () => {
  const now = Date.now();
  return [
    thread("Desk", { updatedAt: now - 2 * MINUTE }),
    thread("Audit", { parentThreadId: "Desk", isPinned: true, updatedAt: now - MINUTE }),
    thread("Audit helper", { parentThreadId: "Audit", updatedAt: now - 3 * MINUTE }),
    thread("Sibling", { parentThreadId: "Desk", updatedAt: now - 4 * MINUTE }),
    thread("Other pin", { parentThreadId: "Desk", isPinned: true, updatedAt: now - 5 * MINUTE }),
  ];
};

test("A pinned child lifts into Pinned by itself with its sub-threads, and pins and unpins touch only the row's thread", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const slot = mount(app, deskFamily());
  fireEvent.click(await screen.findByRole("tab", { name: "Threads" }));
  const panel = () => screen.getByRole("tabpanel");
  const pinnedBlock = () => {
    const heading = within(panel()).getByRole("button", { name: "Collapse Pinned" }).parentElement!;
    return heading.nextElementSibling as HTMLElement;
  };
  const rowIn = (scope: HTMLElement, id: string) =>
    scope.querySelector(`[data-thread-row-id="${id}"]`) as HTMLElement | null;
  const blockIds = () =>
    Array.from(pinnedBlock().querySelectorAll("[data-thread-row-id]"), (node) => node.getAttribute("data-thread-row-id"));

  // Only the pinned children are in Pinned; their parent is not.
  await waitFor(() => expect(blockIds()).toEqual(expect.arrayContaining(["Audit", "Other pin"])));
  expect(blockIds()).not.toContain("Desk");
  expect(blockIds()).not.toContain("Sibling");
  // The pinned child keeps its own sub-thread and names the parent it came from.
  const audit = rowIn(pinnedBlock(), "Audit")!;
  expect(audit.textContent).toContain("↳ Desk");
  fireEvent.click(within(audit).getByRole("button", { name: "Show 1 child thread" }));
  await waitFor(() => expect(blockIds()).toContain("Audit helper"));
  expect(rowIn(pinnedBlock(), "Audit helper")!.textContent).not.toContain("↳");

  // The desk stays in its home with its unpinned worker, and its pin reads its own state.
  await waitFor(() => expect(rowIn(panel(), "Desk")).not.toBeNull());
  expect(pinnedBlock().contains(rowIn(panel(), "Desk"))).toBe(false);
  expect(within(rowIn(panel(), "Desk")!).getByRole("button", { name: "Pin" })).toBeTruthy();
  fireEvent.click(within(rowIn(panel(), "Desk")!).getByRole("button", { name: "Show 1 child thread" }));
  await waitFor(() => expect(rowIn(panel(), "Sibling")).not.toBeNull());
  expect(rowIn(panel(), "Audit helper") && pinnedBlock().contains(rowIn(panel(), "Audit helper"))).toBe(true);

  // Pinning the unpinned worker pins that worker, not the desk.
  fireEvent.click(within(rowIn(panel(), "Sibling")!).getByRole("button", { name: "Pin" }));
  // Unpinning one pinned child leaves the other pinned child alone.
  fireEvent.click(within(audit).getByRole("button", { name: "Unpin" }));
  await waitFor(() => {
    const calls = slot.inspection.sidebarActionCalls.filter((call) => /pin/i.test(call.method));
    expect(calls).toEqual([
      expect.objectContaining({ threadId: "Sibling", pinned: true }),
      expect.objectContaining({ threadId: "Audit", pinned: false }),
    ]);
  });
  slot.lifecycle.unmount();
});

test("A pin toggle writes exactly the toggled thread", () => {
  expect(planPinWrites({ threadId: "Audit", pinned: true })).toEqual([{ threadId: "Audit", pinned: true }]);
  expect(planPinWrites({ threadId: "Audit", pinned: false })).toEqual([{ threadId: "Audit", pinned: false }]);
});

test("In a bot's list a pinned conversation sits at the top level, ahead of the unpinned ones", () => {
  const section = buildBotSection({ id: "chief", name: "Chief" }, deskFamily());
  expect(section.forest.parent.get("Audit")).toBeNull();
  expect(section.forest.parent.get("Audit helper")).toBe("Audit");
  expect(section.forest.parent.get("Sibling")).toBe("Desk");
  expect(section.byShelf.active.map((member) => member.id)).toEqual(["Audit", "Audit helper", "Other pin", "Desk", "Sibling"]);
});
