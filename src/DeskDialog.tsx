import { useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useProviders as useProviders,
  useRpc,
  type ExperimentalProviderModelPickerValue,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { configuredDesk, shortModelName, summarizeDeskResults } from "./desk";
import type { BotSummary, DeskModel, DeskStatus, cursorSidebarRpcContract } from "./server";

const FALLBACK_DESK: DeskModel = { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "high" };
const REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** A datetime-local value three days out, the usual length of a quota pause. */
function defaultUntil(): string {
  const date = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

/**
 * Replace one or more bots' desks. With `switchModel`, first pick the desk
 * model (permanently, or until a time); without it, each bot keeps its current
 * desk model. The dialog names every bot and how many live threads move.
 */
export function DeskDialog({
  bots,
  statuses,
  liveThreads,
  switchModel,
  onClose,
  onDone,
}: {
  bots: readonly BotSummary[];
  statuses: ReadonlyMap<string, DeskStatus>;
  liveThreads: (bot: BotSummary) => number | null;
  switchModel: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const rpc = useRpc<typeof cursorSidebarRpcContract>();
  const first = bots[0]!;
  const [value, setValue] = useState<DeskModel>(() => {
    const current = statuses.get(first.id)?.effective ?? configuredDesk(first).model ?? FALLBACK_DESK;
    return { providerId: current.providerId, model: current.model, reasoningLevel: current.reasoningLevel, ...(current.serviceTier ? { serviceTier: current.serviceTier } : {}) };
  });
  const [temporary, setTemporary] = useState(false);
  const [until, setUntil] = useState(defaultUntil);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = bots.length === 1;
  const plural = single ? "desk" : `${bots.length} desks`;
  const title = switchModel ? (single ? `Desk model for ${first.name}` : `Switch desk model for ${bots.length} bots`) : single ? `Replace ${first.name}’s desk` : `Replace ${bots.length} desks`;
  const action = switchModel ? `Switch and replace ${plural}` : `Replace ${plural}`;
  const routing = single && first.hostId ? { kind: "host" as const, hostId: first.hostId } : undefined;
  const untilTime = temporary ? Date.parse(until) : NaN;
  const invalidUntil = temporary && !(untilTime > Date.now());

  async function submit() {
    if (busy || invalidUntil) return;
    setBusy(true);
    setError(null);
    try {
      const { results } = await rpc.call("botsDeskReplace", {
        botIds: bots.map((bot) => bot.id),
        ...(switchModel ? { desk: value, until: temporary ? new Date(untilTime).toISOString() : null } : {}),
      });
      const names = new Map(bots.map((bot) => [bot.id, bot.name]));
      const summary = summarizeDeskResults(results, (id) => names.get(id) ?? id);
      const description = (
        <ul className="mt-1 flex flex-col gap-0.5">
          {summary.lines.map((line) => <li key={line}>{line}</li>)}
        </ul>
      );
      if (summary.ok) toast.success(summary.title, { description });
      else toast.error(summary.title, { description, duration: 15_000 });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const modelName = shortModelName(value.model);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="cs-move-dialog cs-desk-dialog" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            A desk is the bot’s first conversation, where messages and check-ins land. Replacing it starts a fresh one so the model stops rereading a long history.
          </DialogDescription>
        </DialogHeader>
        {switchModel ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Model</span>
              <DeskModelPicker value={value} onChange={setValue} routing={routing} disabled={busy} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={temporary} disabled={busy} onChange={(event) => setTemporary(event.target.checked)} />
              Temporary until
              <input
                type="datetime-local"
                aria-label="Temporary until"
                value={until}
                disabled={busy || !temporary}
                onChange={(event) => setUntil(event.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
            </label>
            {temporary ? (
              <p className={invalidUntil ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {invalidUntil ? "Choose a time in the future." : "After this time, the next replacement goes back to each bot’s own desk model."}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            {single ? "This will" : `For each of these ${bots.length} bots, this will`}
          </span>
          <p className="text-sm">
            Start a new desk{switchModel ? ` on ${modelName}` : " on the bot’s current desk model"}, move live threads under it, archive the old desk, and point its check-ins at the new one.
          </p>
          <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded border border-border p-2 text-sm">
            {bots.map((bot) => {
              const live = liveThreads(bot);
              const current = statuses.get(bot.id);
              return (
                <li key={bot.id} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{bot.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {live === null ? "live threads unknown" : `${live} live thread${live === 1 ? "" : "s"} move`}
                    {current?.model ? ` · now ${shortModelName(current.model)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded px-3 py-2 text-sm" disabled={busy} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={busy || invalidUntil || (switchModel && !value.model)}
            onClick={() => void submit()}
          >
            {busy ? `Replacing ${plural}…` : action}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** bb's own provider/model picker when the host has it; plain fields otherwise. */
function DeskModelPicker({ value, onChange, routing, disabled }: {
  value: DeskModel;
  onChange: (value: DeskModel) => void;
  routing: { kind: "host"; hostId: string } | undefined;
  disabled: boolean;
}) {
  // The picker is provided by the host at runtime; an older host leaves it undefined.
  if (ProviderModelPicker) {
    return (
      <ProviderModelPicker
        value={value as ExperimentalProviderModelPickerValue}
        {...(routing ? { routing } : {})}
        disabled={disabled}
        align="start"
        className="h-8 max-w-full"
        onChange={(next) => onChange({ providerId: next.providerId, model: next.model, reasoningLevel: next.reasoningLevel, ...(next.serviceTier ? { serviceTier: next.serviceTier } : {}) })}
      />
    );
  }
  return <PlainModelFields value={value} onChange={onChange} disabled={disabled} />;
}

function PlainModelFields({ value, onChange, disabled }: { value: DeskModel; onChange: (value: DeskModel) => void; disabled: boolean }) {
  const providers = useProviders();
  const field = "rounded border border-border bg-background px-2 py-1 text-sm";
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <select aria-label="Provider" className={field} value={value.providerId} disabled={disabled} onChange={(event) => onChange({ ...value, providerId: event.target.value })}>
        {[...new Set([value.providerId, ...providers.providers.map((provider) => provider.id)])].map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <input aria-label="Model" className={field} value={value.model} disabled={disabled} onChange={(event) => onChange({ ...value, model: event.target.value.trim() })} />
      <select aria-label="Reasoning" className={field} value={value.reasoningLevel} disabled={disabled} onChange={(event) => onChange({ ...value, reasoningLevel: event.target.value })}>
        {[...new Set([value.reasoningLevel, ...REASONING_LEVELS])].map((level) => <option key={level} value={level}>{level}</option>)}
      </select>
    </div>
  );
}
