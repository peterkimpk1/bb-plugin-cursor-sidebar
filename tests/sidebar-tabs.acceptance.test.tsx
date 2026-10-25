import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, SidebarView, cursorSidebarRpcContract } from "../src/server";
import { sidebarViewSchema } from "../src/server";
import { DEFAULT_SIDEBAR_VIEW } from "../src/sidebar-view";

function thread(id: string, overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id, title: id, titleFallback: null, projectId: "npi", parentThreadId: null,
    sectionId: null, originKind: null, originPluginId: null, providerId: "codex",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false,
    isArchived: false, environment: null, host: null,
    createdAt: Date.now(), updatedAt: Date.now(), lastReadAt: null, latestAttentionAt: 0,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const bots: BotsListResult = {
  available: true, reason: null, personalProjectId: "personal", projectOwners: [],
  bots: [
    { id: "chief", name: "Chief", role: "Coordination", avatar: { color: "#225588", shape: "round" } },
    { id: "builder", name: "Builder", role: "Implementation", avatar: { color: "#884422", shape: "square" } },
    { id: "toolsmith", name: "Toolsmith", role: "Plugins", avatar: { color: "#448844", shape: "diamond" } },
  ],
  threadBindings: [{ botId: "builder", threadId: "Building the plugin" }],
};

// Distinct, non-letter SVGs stand in for bots-sidebar's server-rendered artwork.
// The test exercises this plugin's real markup selection and cache lifecycle.
const avatars = Object.fromEntries(bots.bots.map((bot) => [bot.id, {
  idle: `<svg xmlns="http://www.w3.org/2000/svg" data-character="${bot.id}" data-pose="idle"><circle r="10"/></svg>`,
  working: `<svg xmlns="http://www.w3.org/2000/svg" data-character="${bot.id}" data-pose="working"><path d="M0 0L10 10"/></svg>`,
}]));
type AvatarReply = { avatars: typeof avatars };

test("Threads → Bots → Threads preserves Peter's Cursor view and every bot's character across remounts", async () => {
  const app = await loadPluginApp(() => import("../app"));
  expect(app.threadLists.map(({ id, title }) => ({ id, title }))).toEqual([
    { id: "cursor-sidebar", title: "Cursor Sidebar" },
  ]);
  const registration = app.threadLists[0]!;
  let savedView: SidebarView = {
    ...DEFAULT_SIDEBAR_VIEW, groupBy: "status", sortConversationsBy: "status",
    show: { updated: false, environment: false, branch: false, host: false, pr: false },
  };
  let avatarReply = deferred<AvatarReply>();
  const rpc = {
    sidebarView: () => ({ view: savedView }),
    setSidebarView: ({ view }) => { savedView = sidebarViewSchema.parse(view); return { view: savedView }; },
    botsList: () => bots,
    botsAvatars: () => avatarReply.promise,
    primaryHost: () => ({ hostId: "mini" }),
    listProjectIcons: () => ({ icons: [] }),
    listWorkspaces: () => ({ workspaces: [{ environmentId: "checkout", path: "/fixture/npi", name: "Fixture checkout", hostId: "laptop" }] }),
    listThreadSections: () => ({ sections: [{ id: "follow-up", name: "Follow up" }] }),
    listThreadOrders: () => ({ orders: [] }),
  } satisfies Partial<PluginRpcTestHandlers<typeof cursorSidebarRpcContract>>;
  const slot = renderSlot<PluginThreadListProps, Pick<typeof cursorSidebarRpcContract, keyof typeof rpc>>(registration, {
    activeThreadId: "Chosen conversation", activeProjectId: "npi",
    isCompactViewport: false, searchQuery: "", onNavigate: () => {},
    Original: () => <p>BB's default thread list must not replace the Cursor view</p>,
  }, {
    rpc,
    sidebarThreads: {
      projects: [
        { id: "npi", name: "NPI Manager", isPersonal: false },
        { id: "other", name: "Other project", isPersonal: false },
        { id: "personal", name: "Personal", isPersonal: true },
      ],
      threads: [
        thread("Pinned conversation", { isPinned: true }),
        thread("Chosen conversation", {
          environment: { id: "checkout", name: "Fixture checkout", branchName: "hidden-branch", workspaceDisplayKind: "other" },
          host: { id: "laptop", name: "Fixture laptop" },
        }),
        thread("Child conversation", { parentThreadId: "Chosen conversation", originKind: "fork" }),
        thread("Hidden in folded project", { projectId: "other" }),
        thread("Filed conversation", { projectId: "personal", sectionId: "follow-up" }),
        thread("Loose conversation", { projectId: "personal" }),
        thread("Building the plugin", {
          updatedAt: Date.now() - 60_000,
          activity: { workflows: 1, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
        }),
      ],
    },
  });

  // Select Projects through the real Cursor view menu, starting from a
  // different saved grouping. A label-only substitute for this list fails.
  fireEvent.click(screen.getByRole("tab", { name: "Threads" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Customize sidebar view" })).toBeTruthy());
  fireEvent.keyDown(screen.getByRole("button", { name: "Customize sidebar view" }), { key: "ArrowDown" });
  fireEvent.keyDown(await screen.findByRole("menuitem", { name: /^Grouping/ }), { key: "ArrowRight" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Projects" }));
  fireEvent.keyDown(screen.getAllByRole("menu").at(-1)!, { key: "Escape" });
  await waitFor(() => expect(savedView.groupBy).toBe("workspace"));
  const chosenView = structuredClone(savedView);
  fireEvent.click(screen.getByRole("button", { name: "Expand NPI Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Threads" }));
  fireEvent.click(screen.getByRole("button", { name: "Show 1 child thread" }));
  await screen.findByRole("link", { name: "Child conversation" });

  function assertThreads() {
    expect(screen.getByRole("tab", { name: "Threads" }).getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel", { name: "Threads" });
    expect(panel.closest("[data-cursor-sidebar-root]")).not.toBeNull();
    expect(screen.queryByText("BB's default thread list must not replace the Cursor view")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Collapse Projects" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Collapse Threads" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Collapse NPI Manager" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Expand Other project" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Hide 1 child thread" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Chosen conversation, selected" }).getAttribute("aria-current")).toBe("true");
    for (const name of ["Pinned conversation", "Child conversation", "Filed conversation", "Loose conversation"]) {
      expect(within(panel).getByRole("link", { name })).toBeTruthy();
    }
    expect(within(panel).queryByRole("link", { name: "Hidden in folded project" })).toBeNull();
    expect(panel.querySelector('[aria-label="Follow up"]')).not.toBeNull();
    expect(savedView).toEqual(chosenView);
    expect(panel.querySelector(".cs-thread-info")).toBeNull();
    return panel;
  }

  function assertCharacters() {
    const panel = screen.getByRole("tabpanel", { name: "Bots" });
    expect(panel.querySelectorAll("[data-bot-row]")).toHaveLength(bots.bots.length);
    for (const bot of bots.bots) {
      const row = panel.querySelector(`[data-bot-row="${bot.id}"]`);
      expect(row, `${bot.name} row`).not.toBeNull();
      const character = row?.querySelector(".cs-bot-character");
      expect(character, `${bot.name} must keep character artwork, never initials`).not.toBeNull();
      expect(character?.querySelector("svg")?.getAttribute("data-character")).toBe(bot.id);
      expect(character?.querySelector("svg")?.getAttribute("data-pose")).toBe(bot.id === "builder" ? "working" : "idle");
      expect(row?.querySelector(".cs-bot-avatar"), `${bot.name} must not fall back to lettering`).toBeNull();
      expect(character?.textContent).toBe("");
    }
    return panel;
  }

  let threadsPanel = assertThreads();
  const threadRows = () => Array.from(screen.getByRole("tabpanel").querySelectorAll("[data-sidebar-thread-id]"), (row) => row.getAttribute("data-sidebar-thread-id"));
  const chosenRows = threadRows();
  expect(chosenRows.indexOf("Building the plugin")).toBeLessThan(chosenRows.indexOf("Chosen conversation"));
  fireEvent.click(screen.getByRole("tab", { name: "Bots" }));
  await act(async () => { avatarReply.resolve({ avatars }); });
  let botsPanel = assertCharacters();

  // Each return to Bots mounts a new view. Check before its RPC can answer,
  // then after empty/rejected refreshes; a fast fixture reply hides the bug.
  for (const outcome of ["empty", "rejected"] as const) {
    const oldBotsRow = botsPanel.querySelector("[data-bot-row]");
    fireEvent.click(screen.getByRole("tab", { name: "Threads" }));
    expect(oldBotsRow?.isConnected).toBe(false);
    threadsPanel = assertThreads();
    expect(threadRows()).toEqual(chosenRows);
    const oldThreadsList = threadsPanel.querySelector(".cs-grouping-swap");
    avatarReply = deferred<AvatarReply>();
    fireEvent.click(screen.getByRole("tab", { name: "Bots" }));
    expect(oldThreadsList?.isConnected).toBe(false);
    botsPanel = assertCharacters();
    await act(async () => {
      if (outcome === "empty") avatarReply.resolve({ avatars: {} });
      else avatarReply.reject(new Error("Avatar service unavailable"));
    });
    botsPanel = assertCharacters();
  }
  fireEvent.click(screen.getByRole("tab", { name: "Threads" }));
  assertThreads();
  expect(threadRows()).toEqual(chosenRows);
  expect(slot.inspection.rpcCalls.filter(({ method }) => method === "botsAvatars")).toHaveLength(3);
  expect(slot.inspection.sidebarActionCalls).toEqual([]);
  slot.lifecycle.unmount();
});
