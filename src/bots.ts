/**
 * Pure model for the Bots tab: which native threads belong to which bot, each
 * bot's display section, and the facts its row shows.
 *
 * Ownership follows bots-sidebar's rule: a thread is a bot's when it is bound
 * to that bot, or when its nearest bound ancestor is. Bots never own a thread
 * by project, because several bots can share a project.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isWorking } from "./activity";
import { buildDisplayForest, type ProjectSectionData } from "./forest";
import type { BotSummary } from "./server";

export const BOT_SECTION_PREFIX = "bot:";

/** Thread id -> owning bot id, for every thread whose ancestry reaches a binding. */
export function threadOwners(
  threads: readonly PluginSidebarThread[],
  bindings: readonly { threadId: string; botId: string }[],
): Map<string, string> {
  const direct = new Map(bindings.map(({ threadId, botId }) => [threadId, botId]));
  const parentOf = new Map(threads.map((thread) => [thread.id, thread.parentThreadId]));
  const owners = new Map<string, string>();
  for (const thread of threads) {
    let cursor: string | null | undefined = thread.id;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const owner = direct.get(cursor);
      if (owner !== undefined) {
        owners.set(thread.id, owner);
        break;
      }
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  return owners;
}

/** True when a thread is asking for the user: a raised hand or an unread failure. */
export function needsYou(thread: PluginSidebarThread): boolean {
  return (
    thread.hasPendingInteraction ||
    thread.indicator === "waiting-for-input" ||
    (thread.isUnread && thread.indicator === "unread-error")
  );
}

export interface BotFacts {
  /** Non-archived threads the bot owns, bound roots and their descendants. */
  members: readonly PluginSidebarThread[];
  working: boolean;
  needsYou: number;
  unread: boolean;
  lastActivityAt: number;
}

export function botFacts(members: readonly PluginSidebarThread[]): BotFacts {
  let working = false;
  let count = 0;
  let unread = false;
  let lastActivityAt = 0;
  for (const thread of members) {
    if (isWorking(thread)) working = true;
    if (needsYou(thread)) count += 1;
    if (thread.isUnread) unread = true;
    lastActivityAt = Math.max(lastActivityAt, thread.updatedAt);
  }
  return { members, working, needsYou: count, unread, lastActivityAt };
}

/** Group the visible (non-archived) feed by owning bot. */
export function membersByBot(
  visible: readonly PluginSidebarThread[],
  bindings: readonly { threadId: string; botId: string }[],
): Map<string, PluginSidebarThread[]> {
  const owners = threadOwners(visible, bindings);
  const groups = new Map<string, PluginSidebarThread[]>();
  for (const thread of visible) {
    if (thread.isArchived) continue;
    const owner = owners.get(thread.id);
    if (owner === undefined) continue;
    const group = groups.get(owner);
    if (group === undefined) groups.set(owner, [thread]);
    else group.push(thread);
  }
  return groups;
}

/**
 * One bot's conversations as a display section, so the Threads view's own
 * ShelfList and ThreadRow draw them. Roots and siblings are ordered by the
 * newest activity anywhere in their subtree, so a busy child lifts its root.
 */
export function buildBotSection(
  bot: Pick<BotSummary, "id" | "name">,
  members: readonly PluginSidebarThread[],
): ProjectSectionData {
  const base = buildDisplayForest(members);
  const latest = new Map<string, number>();
  const latestOf = (thread: PluginSidebarThread, guard: Set<string>): number => {
    const cached = latest.get(thread.id);
    if (cached !== undefined) return cached;
    if (guard.has(thread.id)) return thread.updatedAt;
    guard.add(thread.id);
    let value = thread.updatedAt;
    for (const child of base.children.get(thread.id) ?? []) {
      value = Math.max(value, latestOf(child, guard));
    }
    latest.set(thread.id, value);
    return value;
  };
  const compare = (left: PluginSidebarThread, right: PluginSidebarThread) =>
    latestOf(right, new Set()) - latestOf(left, new Set()) ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id);

  const children = new Map<string, PluginSidebarThread[]>();
  for (const thread of members) {
    children.set(thread.id, [...(base.children.get(thread.id) ?? [])].sort(compare));
  }
  const roots = members.filter((thread) => (base.parent.get(thread.id) ?? null) === null).sort(compare);
  // byShelf is in walk order: flattenShelf takes roots from it in this order.
  const ordered: PluginSidebarThread[] = [];
  const emitted = new Set<string>();
  const walk = (thread: PluginSidebarThread) => {
    if (emitted.has(thread.id)) return;
    emitted.add(thread.id);
    ordered.push(thread);
    for (const child of children.get(thread.id) ?? []) walk(child);
  };
  for (const root of roots) walk(root);

  return {
    id: `${BOT_SECTION_PREFIX}${bot.id}`,
    name: bot.name,
    known: true,
    personal: false,
    members,
    forest: { parent: base.parent, children },
    shelfById: new Map(members.map((thread) => [thread.id, "active" as const])),
    byShelf: { active: ordered, settled: [] },
    scopeIds: new Map(),
  };
}

/**
 * The thread a click on the bot opens: its main conversation if still visible,
 * else the first visible one in its manual order, else its newest visible one.
 */
export function botOpenTarget(
  bot: Pick<BotSummary, "mainThreadId" | "threadOrder">,
  members: readonly PluginSidebarThread[],
  section: ProjectSectionData,
): string | null {
  const ids = new Set(members.map((thread) => thread.id));
  if (bot.mainThreadId && ids.has(bot.mainThreadId)) return bot.mainThreadId;
  for (const id of bot.threadOrder ?? []) {
    if (ids.has(id)) return id;
  }
  // Never reopen an archived main: fall back to the newest visible conversation.
  return section.byShelf.active[0]?.id ?? null;
}

/** The bot's initial for its avatar. */
export function botInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  return [...trimmed][0]!.toLocaleUpperCase();
}

/** Readable ink for an avatar fill, by relative luminance. */
export function avatarInk(hex: string): "#000" | "#fff" {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) return "#fff";
  const [r, g, b] = match.slice(1).map((part) => {
    const channel = Number.parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#000" : "#fff";
}

/**
 * Where a new conversation for this bot starts, matching bots-sidebar: the
 * project the bot owns when it owns one, else BB's personal project.
 */
export function botLaunchProjectId(
  bot: Pick<BotSummary, "id" | "linkedProjectIds" | "legacyHomeProjectId">,
  owners: readonly { projectId: string; botId: string }[],
  personalProjectId: string | null,
): { projectId: string | null; owned: boolean } {
  const owned = new Set(
    owners
      .filter((owner) => owner.botId === bot.id && owner.projectId !== personalProjectId && owner.projectId !== bot.legacyHomeProjectId)
      .map((owner) => owner.projectId),
  );
  const preferred = (bot.linkedProjectIds ?? []).find((id) => owned.has(id)) ?? [...owned][0];
  if (preferred !== undefined) return { projectId: preferred, owned: true };
  return { projectId: personalProjectId, owned: false };
}
