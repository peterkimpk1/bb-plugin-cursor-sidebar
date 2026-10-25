/**
 * A bot's desk is its first conversation, where bot messages and check-ins
 * land. bots-sidebar stores the desk model in the bot's settings and reports
 * what each desk actually runs; this module turns both into row labels.
 */
import type { BotSummary, DeskModel, DeskReplaceResult, DeskStatus } from "./server";

/** "claude-sonnet-5-5" -> "Sonnet", "gpt-6.1-sol" -> "Sol"; unknown shapes stay as given. */
export function shortModelName(model: string): string {
  const words = model
    .toLowerCase()
    .split(/[-_/.\s]+/)
    .filter((part) => /^[a-z]+$/.test(part) && !["claude", "gpt", "openai", "anthropic", "latest", "preview"].includes(part));
  const word = words.at(-1);
  return word ? word[0]!.toUpperCase() + word.slice(1) : model;
}

/** Active override, else the desk setting, else the bot's launch model, else project defaults (null). */
export function configuredDesk(bot: Pick<BotSummary, "settings" | "launchPreset">, now = Date.now()): { model: DeskModel | null; until: number | null } {
  const override = bot.settings?.deskOverride ?? null;
  const until = override ? Date.parse(override.until) : NaN;
  if (override && until > now) return { model: override, until };
  if (bot.settings?.desk) return { model: bot.settings.desk, until: null };
  const execution = bot.launchPreset?.execution ?? null;
  return { model: execution, until: null };
}

const describe = (model: Pick<DeskModel, "providerId" | "model"> & { reasoningLevel?: string | null }) =>
  `${model.providerId} ${model.model}${model.reasoningLevel ? ` (${model.reasoningLevel})` : ""}`;
export const shortDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDate = (time: number) => new Date(time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The row's compact desk label ("Sol · desk") plus its hover text. The label
 * names what the desk runs now when bots-sidebar reports it, else what the
 * next desk will run.
 */
export function deskLabel(bot: BotSummary, status: DeskStatus | undefined, now = Date.now()): { label: string; until: string | null; title: string } | null {
  const configured = configuredDesk(bot, now);
  const running = status?.providerId && status.model ? { providerId: status.providerId, model: status.model } : null;
  const shown = running ?? configured.model;
  if (!shown) return null;
  const lines = [`Desk runs ${describe(running ?? shown)}${status?.contextTokens != null ? `, ${status.contextTokens.toLocaleString()} tokens in context` : ""}.`];
  if (configured.until !== null) {
    const fallback = bot.settings?.desk ?? bot.launchPreset?.execution ?? null;
    lines.push(`Temporary desk model until ${longDate(configured.until)}${fallback ? `, then ${describe(fallback)}` : ""}.`);
  }
  if (running && configured.model && (configured.model.model !== running.model || configured.model.providerId !== running.providerId)) {
    lines.push(`The next desk replacement uses ${describe(configured.model)}.`);
  }
  return {
    label: `${shortModelName(shown.model)} · desk`,
    until: configured.until === null ? null : `until ${shortDate(configured.until)}`,
    title: lines.join(" "),
  };
}

/** One toast's worth of per-bot outcomes. */
export function summarizeDeskResults(results: readonly DeskReplaceResult[], name: (botId: string) => string): { ok: boolean; title: string; lines: string[] } {
  const replaced = results.filter((result) => !result.error && !result.skipped && result.newDeskId);
  const failed = results.filter((result) => result.error);
  const lines = results.map((result) => {
    const who = name(result.botId);
    if (result.skipped) return `${who}: skipped. ${result.skipped}`;
    if (result.error) return `${who}: failed. ${result.error}`;
    const moved = `${result.moved.length} live thread${result.moved.length === 1 ? "" : "s"} moved`;
    const automations = result.automationsRetargeted.length ? `, ${result.automationsRetargeted.length} automation${result.automationsRetargeted.length === 1 ? "" : "s"} retargeted` : "";
    const pending = result.automationsPending?.length ? `; ${result.automationsPending.length} automation${result.automationsPending.length === 1 ? "" : "s"} still point at the old desk` : "";
    return `${who}: new desk, ${moved}${automations}${pending}.`;
  });
  const title = failed.length
    ? `${failed.length} of ${results.length} desk replacement${results.length === 1 ? "" : "s"} failed`
    : `Replaced ${replaced.length} desk${replaced.length === 1 ? "" : "s"}`;
  return { ok: failed.length === 0, title, lines };
}
