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

export interface ActiveEntry {
  thread: PluginSidebarThread;
  kind: ActiveKind;
}

/**
 * The Active list: one row per thread, by kind in `ACTIVE_KINDS` order, newest
 * activity first within a kind. A pinned thread gets its own row under Pinned
 * while it is active, wherever it sits in its family.
 */
export function activeEntries(threads: readonly PluginSidebarThread[]): ActiveEntry[] {
  const entries: ActiveEntry[] = [];
  for (const thread of threads) {
    const kind = activeKind(thread);
    if (kind !== null) entries.push({ thread, kind });
  }
  const rank = new Map(ACTIVE_KINDS.map((kind, index) => [kind, index]));
  return entries.sort((left, right) =>
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
