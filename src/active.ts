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
