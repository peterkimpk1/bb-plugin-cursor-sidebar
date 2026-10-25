import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { loadPluginApp, renderSlot, type PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { BotsListResult, DeskStatus, cursorSidebarRpcContract } from "../src/server";
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

const SOL = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high" };
const SONNET = { providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: "high" };
const until = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

const bots: BotsListResult = {
  available: true, reason: null, personalProjectId: "personal", projectOwners: [],
  bots: [
    { id: "chief", name: "Chief", role: "Chief of staff", hostId: "laptop", mainThreadId: "chief-desk", settings: { desk: SONNET, deskOverride: { ...SOL, until } } },
    { id: "builder", name: "Builder", role: "Implementation", hostId: "mini", mainThreadId: "builder-desk", settings: { desk: SONNET } },
    { id: "merge", name: "Merge", role: "Merges", hostId: "mini" },
  ],
  threadBindings: [{ botId: "chief", threadId: "chief-desk" }, { botId: "builder", threadId: "builder-desk" }],
};
const status = (botId: string, model: string | null, liveChildren: number): DeskStatus => ({
  botId, deskId: `${botId}-desk`, providerId: model ? "codex" : null, model, contextTokens: 40_000, liveChildren,
  desk: null, deskOverride: null, effective: null,
});

test("Bots tab labels desk models, edits one bot's desk, and replaces several in Select mode", async () => {
  const app = await loadPluginApp(() => import("../app"));
  const replaceCalls: unknown[] = [];
  const rpc = {
    sidebarView: () => ({ view: DEFAULT_SIDEBAR_VIEW }),
    setSidebarView: ({ view }) => ({ view: sidebarViewSchema.parse(view) }),
    botsList: () => bots,
    botsAvatars: () => ({ avatars: {} }),
    // Chief's desk already runs Sol; Builder's status is not reported, so its saved desk shows.
    botsDeskStatus: () => ({ available: true, bots: [status("chief", "gpt-6.1-sol", 3)] }),
    botsDeskReplace: (input) => {
      replaceCalls.push(input);
      return { results: input.botIds.map((botId) => ({ botId, oldDeskId: `${botId}-desk`, newDeskId: `${botId}-new`, moved: [], automationsRetargeted: ["Bot check-in"] })) };
    },
    primaryHost: () => ({ hostId: "mini" }),
    listProjectIcons: () => ({ icons: [] }),
    listWorkspaces: () => ({ workspaces: [] }),
    listThreadSections: () => ({ sections: [] }),
    listThreadOrders: () => ({ orders: [] }),
  } satisfies Partial<PluginRpcTestHandlers<typeof cursorSidebarRpcContract>>;
  const slot = renderSlot<PluginThreadListProps, Pick<typeof cursorSidebarRpcContract, keyof typeof rpc>>(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: "npi", isCompactViewport: false, searchQuery: "", onNavigate: () => {},
    Original: () => null,
  }, {
    rpc,
    sidebarThreads: {
      projects: [{ id: "npi", name: "NPI Manager", isPersonal: false }],
      threads: [
        thread("chief-desk"), thread("builder-desk"),
        thread("builder-work-1", { parentThreadId: "builder-desk" }), thread("builder-work-2", { parentThreadId: "builder-desk" }),
      ],
    },
  });

  fireEvent.click(screen.getByRole("tab", { name: "Bots" }));
  const panel = await screen.findByRole("tabpanel", { name: "Bots" });
  const row = (id: string) => panel.querySelector(`[data-bot-row="${id}"]`) as HTMLElement;
  await waitFor(() => expect(row("chief").querySelector(".cs-bot-desk")?.textContent).toBe("Sol · desk"));
  expect(row("chief").querySelector(".cs-bot-desk-until")?.textContent).toMatch(/^until /);
  expect(row("chief").querySelector(".cs-bot-desk")?.getAttribute("title")).toContain("then claude-code claude-sonnet-5-5");
  expect(row("builder").querySelector(".cs-bot-desk")?.textContent).toBe("Sonnet · desk");
  expect(row("builder").querySelector(".cs-bot-desk-until")).toBeNull();
  expect(row("merge").querySelector(".cs-bot-desk")).toBeNull();

  // Per-bot menu: Desk model… names the bot and the live threads that move.
  fireEvent.click(within(panel).getByRole("button", { name: "Actions for Chief" }));
  fireEvent.click(await screen.findByRole("button", { name: "Desk model…" }));
  let dialog = await screen.findByRole("dialog", { name: "Desk model for Chief" });
  expect(within(dialog).getByText("3 live threads move", { exact: false })).toBeTruthy();
  expect(within(dialog).getByTestId("bb-provider-model-picker").getAttribute("data-routing-id")).toBe("laptop");
  // Chief is on a temporary model: the dialog keeps it temporary, ending when it does.
  expect((within(dialog).getByRole("checkbox", { name: "Temporary desk model" }) as HTMLInputElement).checked).toBe(true);
  expect(Date.parse((dialog.querySelector("input[type=datetime-local]") as HTMLInputElement).value)).toBe(Math.floor(Date.parse(until) / 60_000) * 60_000);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(replaceCalls).toEqual([]);

  // Select mode: checkboxes, an action bar, and one request for every selected bot.
  fireEvent.click(within(panel).getByRole("button", { name: "Select" }));
  expect(within(panel).getByRole("button", { name: "Replace desks" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(within(panel).getByRole("checkbox", { name: "Select Chief" }));
  fireEvent.click(within(panel).getByRole("checkbox", { name: "Select Builder" }));
  expect(within(panel).getByText("2 selected")).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", { name: "Switch model…" }));
  dialog = await screen.findByRole("dialog", { name: "Switch desk model for 2 bots" });
  expect(within(dialog).getByText("2 live threads move", { exact: false })).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: "claude-opus-5-5" } });
  fireEvent.change(within(dialog).getByLabelText("Provider ID"), { target: { value: "claude-code" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Apply execution selection" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Switch and replace 2 desks" }));
  await waitFor(() => expect(replaceCalls).toHaveLength(1));
  expect(replaceCalls[0]).toEqual({ botIds: ["chief", "builder"], desk: { providerId: "claude-code", model: "claude-opus-5-5", reasoningLevel: "high" }, until: null });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(within(panel).queryByRole("checkbox")).toBeNull();

  // Replace desks keeps each bot's model: no desk in the request.
  fireEvent.click(within(panel).getByRole("button", { name: "Select" }));
  fireEvent.click(within(panel).getByRole("button", { name: "All" }));
  fireEvent.click(within(panel).getByRole("button", { name: "Replace desks" }));
  dialog = await screen.findByRole("dialog", { name: "Replace 3 desks" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Replace 3 desks" }));
  await waitFor(() => expect(replaceCalls).toHaveLength(2));
  expect(replaceCalls[1]).toEqual({ botIds: ["chief", "builder", "merge"] });
  slot.lifecycle.unmount();
});
