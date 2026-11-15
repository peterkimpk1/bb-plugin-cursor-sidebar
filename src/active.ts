/**
 * Pure model for the Active view: every non-archived thread that matters right
 * now, at any depth, as one flat list.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isWorking } from "./activity";
import { isActivityIndicator } from "./StatusGlyph";

export type ActiveKind = "pinned" | "input" | "working" | "failed";

/**
 * Display order: what you pinned, then what needs you, then what runs, then
 * what broke.
 */
export const ACTIVE_KINDS: readonly ActiveKind[] = ["pinned", "input", "working", "failed"];

export const ACTIVE_KIND_LABEL: Record<ActiveKind, string> = {
  pinned: "Pinned",
  input: "Needs you",
  working: "Working",
  failed: "Failed",
};

/**
 * Why a thread is in the Active view, or null when it is not. The input rule
 * is the raised-hand half of `needsYou` in bots.ts; its unread-failure half is
 * the separate "failed" kind here.
 */
export function activeKind(thread: PluginSidebarThread): ActiveKind | null {
  if (thread.isArchived) return null;
  const kind = needsInput(thread)
    ? "input"
    : isWorking(thread) || isActivityIndicator(thread.indicator)
      ? "working"
      : thread.isUnread && thread.indicator === "unread-error"
        ? "failed"
        : null;
  return kind !== null && thread.isPinned ? "pinned" : kind;
}

/** The raised hand: a pending question or a thread waiting for input. */
export function needsInput(thread: PluginSidebarThread): boolean {
  return thread.hasPendingInteraction || thread.indicator === "waiting-for-input";
}

/** "Peter’s Mac Mini" → "Mac Mini": the owner's name repeats on every row. */
export function shortMachineName(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[^\s]+['’]s\s+/u, "") || trimmed;
}

/** Which glyph stands for a machine: the Mac mini box, a laptop, or none (name it instead). */
export type MachineKind = "mini" | "laptop";
export function machineKind(name: string | null | undefined): MachineKind | null {
  if (!name) return null;
  if (/\bmini\b/i.test(name)) return "mini";
  if (/macbook|\bmbp\b|laptop/i.test(name)) return "laptop";
  return null;
}

export type ActiveEntry =
  | { thread: PluginSidebarThread; kind: "pinned"; pins: readonly PluginSidebarThread[] }
  | { thread: PluginSidebarThread; kind: Exclude<ActiveKind, "pinned"> };

/** Pins choose the family; current activity decides whether that family is shown. */
export function activeEntries(threads: readonly PluginSidebarThread[]): ActiveEntry[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const pins = threads.filter((thread) => thread.isPinned && !thread.isArchived);
  const tree = activeGroupTree(pins.map((thread) => ({ thread })), (id) => byId.get(id));
  const pinsByRoot = new Map<string, PluginSidebarThread[]>();
  for (const thread of pins) {
    let root = thread.id;
    const seen = new Set<string>();
    while (!seen.has(root)) {
      seen.add(root);
      const parent = tree.parent.get(root);
      if (parent == null) break;
      root = parent;
    }
    const family = pinsByRoot.get(root) ?? [];
    family.push(thread);
    pinsByRoot.set(root, family);
  }
  const represented = new Set<string>();
  const entries: ActiveEntry[] = [];
  for (const root of tree.members) {
    const family = pinsByRoot.get(root.id);
    if (family === undefined) continue;
    if (activeKind(root) === null && !family.some((thread) => activeKind(thread) !== null)) continue;
    represented.add(root.id);
    for (const thread of family) represented.add(thread.id);
    entries.push({ thread: root, kind: "pinned", pins: family });
  }
  for (const thread of threads) {
    if (represented.has(thread.id)) continue;
    const kind = activeKind(thread);
    if (kind !== null && kind !== "pinned") entries.push({ thread, kind });
  }
  const rank = new Map(ACTIVE_KINDS.map((kind, index) => [kind, index]));
  const recency = (entry: ActiveEntry) => entry.kind === "pinned"
    ? Math.max(entry.thread.updatedAt, ...entry.pins.map((thread) => thread.updatedAt))
    : entry.thread.updatedAt;
  return entries.sort((left, right) =>
    rank.get(left.kind)! - rank.get(right.kind)! || recency(right) - recency(left) || left.thread.id.localeCompare(right.thread.id),
  );
}

/**
 * The row's context line: owning bot, project, machine, parent thread; unknown
 * parts drop out. The parent goes last because its title is the long one, so a
 * narrow sidebar truncates it rather than the project or machine.
 */
export function activeContext(parts: {
  botName: string | null;
  parentTitle: string | null;
  projectName: string | null;
  machineName?: string | null;
}): string {
  return [
    parts.botName,
    parts.projectName,
    parts.machineName ?? null,
    parts.parentTitle === null ? null : `↳ ${parts.parentTitle}`,
  ]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .join(" · ");
}

/** One kind's rows as a small forest, so children sit under their parent. */
export interface ActiveGroupTree {
  /** Display order, parents before their children; includes holder rows. */
  members: PluginSidebarThread[];
  parent: Map<string, string | null>;
  /** Each parent's children, the most recently active family first. */
  children: Map<string, PluginSidebarThread[]>;
  /**
   * Parents outside this kind that hold one or more of its rows (a bot desk
   * with several workers, say). They are drawn muted, only to group.
   */
  holders: Set<string>;
}

/**
 * Resolve pinned families before rendering only their roots. A pin belongs
 * under its nearest pinned ancestor, or its direct parent when that parent
 * is available. Families sort by their latest pinned activity.
 */
export function activeGroupTree(
  entries: readonly Pick<ActiveEntry, "thread">[],
  threadOf: (threadId: string) => PluginSidebarThread | undefined,
): ActiveGroupTree {
  const inGroup = new Map(entries.map((entry) => [entry.thread.id, entry.thread]));
  const nearestInGroup = (thread: PluginSidebarThread): string | null => {
    const seen = new Set([thread.id]);
    let parentId = thread.parentThreadId;
    while (parentId !== null && !seen.has(parentId)) {
      if (inGroup.has(parentId)) return parentId;
      seen.add(parentId);
      parentId = threadOf(parentId)?.parentThreadId ?? null;
    }
    return null;
  };

  const parent = new Map<string, string | null>();
  const offParentCount = new Map<string, number>();
  for (const thread of inGroup.values()) {
    const ancestor = nearestInGroup(thread);
    parent.set(thread.id, ancestor);
    const direct = thread.parentThreadId;
    if (ancestor === null && direct !== null) {
      const holder = threadOf(direct);
      if (holder !== undefined && !holder.isArchived) {
        offParentCount.set(direct, (offParentCount.get(direct) ?? 0) + 1);
      }
    }
  }
  const holders = new Set([...offParentCount].filter(([, count]) => count >= 1).map(([id]) => id));
  for (const thread of inGroup.values()) {
    if (parent.get(thread.id) === null && thread.parentThreadId !== null && holders.has(thread.parentThreadId)) {
      parent.set(thread.id, thread.parentThreadId);
    }
  }
  for (const holderId of holders) parent.set(holderId, null);

  const byId = (id: string) => inGroup.get(id) ?? threadOf(id)!;
  const childIds = new Map<string, string[]>();
  for (const [id, parentId] of parent) {
    if (parentId === null) continue;
    childIds.set(parentId, [...(childIds.get(parentId) ?? []), id]);
  }
  // A family's recency is its newest member in this kind; a holder's own
  // update time does not count.
  const recency = new Map<string, number>();
  const recencyOf = (id: string): number => {
    const known = recency.get(id);
    if (known !== undefined) return known;
    recency.set(id, 0);
    const own = holders.has(id) ? 0 : byId(id).updatedAt;
    const value = Math.max(own, ...(childIds.get(id) ?? []).map(recencyOf));
    recency.set(id, value);
    return value;
  };
  const byRecency = (left: string, right: string) =>
    recencyOf(right) - recencyOf(left) || left.localeCompare(right);

  const children = new Map<string, PluginSidebarThread[]>();
  for (const [parentId, ids] of childIds) children.set(parentId, ids.sort(byRecency).map(byId));
  const members: PluginSidebarThread[] = [];
  const visit = (id: string) => {
    members.push(byId(id));
    for (const child of children.get(id) ?? []) visit(child.id);
  };
  [...parent].filter(([, parentId]) => parentId === null).map(([id]) => id).sort(byRecency).forEach(visit);
  return { members, parent, children, holders };
}
