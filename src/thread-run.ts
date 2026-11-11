/**
 * What a row says about a thread's run: the model its latest turn used and,
 * while a turn runs, how long it has been going. The sidebar feed carries
 * neither, so the server reads both per thread (`threadRuns`); these helpers
 * only shape the answer for the row.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadRun } from "./server";

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * A model name short enough for the row. Catalog names pass through
 * ("Opus 5.5"); Codex names put the variant first so they read the same way
 * ("GPT-6.1-Sol" -> "Sol 6.1"); a raw id gets the same treatment when the
 * catalog had no entry for it ("claude-opus-5-5" -> "Opus 5.5").
 */
export function compactModelName(name: string): string {
  const trimmed = name.trim();
  const gpt = /^gpt-?(\d+(?:\.\d+)*)[-\s]+([a-z]+)$/i.exec(trimmed);
  if (gpt) return `${capitalize(gpt[2]!.toLowerCase())} ${gpt[1]}`;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(trimmed);
  if (claude) return `${capitalize(claude[1]!.toLowerCase())} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}`;
  return trimmed;
}

const QUIET_LEVELS = new Set(["", "none", "off", "default"]);

/** "Opus 5.5 high": the model, then its reasoning level unless that is off. */
export function modelLine(run: ThreadRun | null | undefined): string | null {
  const name = run?.modelLabel ?? run?.model ?? null;
  if (!name) return null;
  const level = run?.reasoningLevel?.trim().toLowerCase() ?? "";
  return QUIET_LEVELS.has(level) ? name : `${name} ${level}`;
}

const MINUTE = 60_000;

/**
 * How long the current turn has run, as coarse as the age labels it replaces:
 * "<1m", "12m", "1h 5m", "14h". `now` is the list's minute clock.
 */
export function workingForLabel(startedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - startedAt) / MINUTE);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours < 10 && rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * A turn is running right now. Background work alone (a command or agent left
 * running after the turn ended) does not count: its turn start would overstate
 * how long the thread has been busy.
 */
export function isRunningTurn(thread: PluginSidebarThread): boolean {
  if (thread.hasPendingInteraction) return false;
  // `status` is newer than the SDK types this plugin builds against.
  const status = (thread as { status?: unknown }).status;
  return status === "active" || status === "starting" || thread.indicator === "runtime";
}
