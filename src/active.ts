/**
 * Pure model for the Active view: every non-archived thread that matters right
 * now, at any depth, as one flat list.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isWorking } from "./activity";
import { isActivityIndicator } from "./StatusGlyph";

/** A thread touched this recently counts as active even when it is quiet. */
export const ACTIVE_RECENT_MS = 2 * 60 * 60 * 1000;

export type ActiveKind = "pinned" | "input" | "working" | "failed" | "recent";

/**
 * Display order: what you pinned, then what needs you, then what runs, then
 * what broke, then the rest.
 */
export const ACTIVE_KINDS: readonly ActiveKind[] = ["pinned", "input", "working", "failed", "recent"];

export const ACTIVE_KIND_LABEL: Record<ActiveKind, string> = {
  pinned: "Pinned",
  input: "Needs you",
  working: "Working",
  failed: "Failed",
  recent: "Recent",
};

/**
 * Why a thread is in the Active view, or null when it is not. The input rule
 * is the raised-hand half of `needsYou` in bots.ts; its unread-failure half is
 * the separate "failed" kind here.
 */
export function activeKind(thread: PluginSidebarThread, now: number): ActiveKind | null {
  if (thread.isArchived) return null;
  // A pinned thread stays at the top whatever it is doing; its status glyph
  // still says when it needs you.
  if (thread.isPinned) return "pinned";
  if (needsInput(thread)) return "input";
  if (isWorking(thread) || isActivityIndicator(thread.indicator)) return "working";
  if (thread.isUnread && thread.indicator === "unread-error") return "failed";
  if (now - thread.updatedAt <= ACTIVE_RECENT_MS) return "recent";
  return null;
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

export interface ActiveEntry {
  thread: PluginSidebarThread;
  kind: ActiveKind;
}

/** The Active list: by kind in `ACTIVE_KINDS` order, newest activity first within a kind. */
export function activeEntries(threads: readonly PluginSidebarThread[], now: number): ActiveEntry[] {
  const rank = new Map(ACTIVE_KINDS.map((kind, index) => [kind, index]));
  const entries: ActiveEntry[] = [];
  for (const thread of threads) {
    const kind = activeKind(thread, now);
    if (kind !== null) entries.push({ thread, kind });
  }
  return entries.sort(
    (left, right) =>
      rank.get(left.kind)! - rank.get(right.kind)! ||
      right.thread.updatedAt - left.thread.updatedAt ||
      left.thread.id.localeCompare(right.thread.id),
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
   * Parents outside this kind that hold two or more of its rows (a bot desk
   * with several workers, say). They are drawn muted, only to group.
   */
  holders: Set<string>;
}

/**
 * Nest one kind's entries. A row goes under its nearest ancestor in the same
 * kind. Rows whose parent is not in the kind, and who share that parent with
 * another row, go under the parent as a muted holder row. Anything else stays
 * at the top with its ↳ context line. Families sort by their latest activity,
 * so a busy child pulls its parent up.
 */
export function activeGroupTree(
  entries: readonly ActiveEntry[],
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
  const holders = new Set([...offParentCount].filter(([, count]) => count >= 2).map(([id]) => id));
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
