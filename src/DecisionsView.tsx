import { useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { DecisionAnswer, DecisionRow } from "./server";
import type { Decisions } from "./useDecisions";

/**
 * Opsdesk's decision queue in the sidebar: every open task that waits on you,
 * across projects, earliest due first. Answering goes through Opsdesk, which
 * comments the answer and closes the task so the waiting thread wakes to it.
 */
export function DecisionsView({ decisions, onNavigate }: { decisions: Decisions; onNavigate: () => void }) {
  const { state, refresh } = decisions;
  const [refreshing, setRefreshing] = useState(false);
  const reload = () => {
    setRefreshing(true);
    void refresh(true).finally(() => setRefreshing(false));
  };
  // Opening the list reads past the shared poll, so it starts current.
  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  if (state.status === "loading") {
    return (
      <p role="status" className="px-3 py-6 text-center text-xs text-sidebar-foreground/73">
        Loading decisions…
      </p>
    );
  }
  if (state.status === "unavailable") {
    return <Empty title="Opsdesk isn’t answering" detail="Decisions come from the Opsdesk plugin. Enable it to see them here." />;
  }

  const projects = state.projects.filter((project) => project.rows.length > 0 || project.error !== null);
  const rows = projects.flatMap((project) => project.rows);
  const approvals = rows.filter((row) => row.kind === "approval").length;
  const defaulted = rows.filter((row) => row.hasDefaulted).length;
  const overdue = rows.filter((row) => row.isOverdue && !row.hasDefaulted).length;
  const unread = projects.filter((project) => project.error !== null);
  const summary = [
    rows.length > 0 ? `${rows.length} waiting` : unread.length > 0 ? "Couldn’t read the queue" : "Nothing waiting on you",
    approvals ? `${approvals} approval${approvals === 1 ? "" : "s"}` : null,
    defaulted ? `${defaulted} defaulted` : null,
    overdue ? `${overdue} overdue` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const grouped = projects.length > 1;

  return (
    <>
      <div className="flex min-h-7 items-center gap-1 pb-1 pl-3 pr-1">
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-xs font-medium text-sidebar-foreground/73">
          {summary}
        </span>
        <button
          type="button"
          aria-label="Refresh decisions"
          title="Refresh decisions"
          disabled={refreshing}
          onClick={reload}
          className="flex size-6 shrink-0 items-center justify-center rounded text-sidebar-foreground/73 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:opacity-50 max-md:size-9 pointer-coarse:size-9"
        >
          <Icon name="RotateCcw" className={cn("size-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
        </button>
      </div>
      {rows.length === 0 && projects.length === 0 ? (
        <Empty title="Nothing is waiting on you" detail="Tasks labelled decision or approval show up here until you answer them." />
      ) : null}
      <div className="flex flex-col gap-3">
        {projects.map((project) => (
          <section key={project.projectId} aria-label={project.name}>
            {grouped ? (
              <h3 className="flex items-center gap-1.5 px-3 pb-1 text-2xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                <span className="truncate">{project.name}</span>
                {project.rows.length ? <span className="tabular-nums">{project.rows.length}</span> : null}
              </h3>
            ) : null}
            {project.error !== null ? (
              <p role="status" title={project.error} className="px-3 pb-1 text-2xs text-sidebar-foreground/60">
                Couldn’t read {project.name} just now{project.rows.length > 0 ? "; showing the last list" : ""}. It retries on its own.
              </p>
            ) : null}
            <ul className="flex flex-col gap-1.5">
              {project.rows.map((row) => (
                <DecisionCard
                  key={row.taskId}
                  row={row}
                  onNavigate={onNavigate}
                  onAnswer={async (answer) => {
                    await decisions.answer(project.projectId, row.taskId, answer);
                    toast.success(`${row.key} ${answer.kind === "dismiss" ? "dismissed" : "answered"}`, { description: row.title });
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

const BUTTON =
  "rounded-md px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 max-md:min-h-9 pointer-coarse:min-h-9";
const PRIMARY = cn(BUTTON, "bg-primary text-primary-foreground hover:bg-primary/90");
const SECONDARY = cn(BUTTON, "border border-sidebar-border text-sidebar-foreground/90 hover:bg-sidebar-accent/60");

function DecisionCard({
  row,
  onAnswer,
  onNavigate,
}: {
  row: DecisionRow;
  onAnswer: (answer: DecisionAnswer) => Promise<void>;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  // "answer" writes a different pick; "decline" refuses an approval.
  const [draft, setDraft] = useState<"answer" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const approval = row.kind === "approval";

  const send = async (answer: DecisionAnswer) => {
    setBusy(true);
    setError(null);
    try {
      await onAnswer(answer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="cs-decision mx-1.5 rounded-md border border-sidebar-border px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-2xs leading-4 text-sidebar-foreground/73">
        <TaskLink taskKey={row.key} onNavigate={onNavigate} />
        <span>{approval ? "Approval" : "Decision"}</span>
        <DueLabel row={row} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="mt-1 block w-full rounded text-left text-sm leading-5 text-sidebar-foreground/95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
      >
        <span className={cn("block", !open && "line-clamp-3")}>{row.title}</span>
      </button>
      {open && row.summary ? <p className="mt-1 text-xs leading-4 text-sidebar-foreground/73">{row.summary}</p> : null}
      {open && row.parentKey !== null ? (
        <p className="mt-1 text-2xs leading-4 text-sidebar-foreground/73">
          Blocks <TaskLink taskKey={row.parentKey} onNavigate={onNavigate} />
          {row.parentTitle ? ` ${row.parentTitle}` : null}
        </p>
      ) : null}
      {row.defaultPick !== null ? (
        <p className={cn("mt-1 text-xs leading-4 text-sidebar-foreground/90", !open && "line-clamp-2")}>
          <span className="text-sidebar-foreground/60">Default: </span>
          {row.defaultPick}
        </p>
      ) : null}
      {draft === null ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {approval ? (
            <>
              <button type="button" className={PRIMARY} disabled={busy} onClick={() => void send({ kind: "approve", note: "" })}>
                {busy ? "Saving…" : "Approve"}
              </button>
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => setDraft("decline")}>
                Decline…
              </button>
            </>
          ) : (
            <>
              {row.hasDefaulted ? (
                // It already went ahead with the default; dismissing keeps that and clears the card.
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={busy}
                  title="Keep the default it went ahead with, and clear this"
                  onClick={() => void send({ kind: "dismiss" })}
                >
                  {busy ? "Saving…" : "Dismiss"}
                </button>
              ) : row.defaultPick !== null ? (
                <button type="button" className={PRIMARY} disabled={busy} onClick={() => void send({ kind: "accept-default" })}>
                  {busy ? "Saving…" : "Accept default"}
                </button>
              ) : null}
              <button type="button" className={SECONDARY} disabled={busy} onClick={() => setDraft("answer")}>
                Answer…
              </button>
            </>
          )}
        </div>
      ) : (
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send({ kind: draft, note });
          }}
        >
          <label htmlFor={noteId} className="sr-only">
            {draft === "decline" ? "Why you are declining (optional)" : "Your answer"}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={4000}
            // The field opened because you asked for it.
            autoFocus
            disabled={busy}
            placeholder={draft === "decline" ? "Why, and what would change your mind (optional)" : "The pick, in your words"}
            className="block w-full resize-y rounded-md border border-sidebar-border bg-transparent px-2 py-1.5 text-xs leading-4 text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="submit" className={PRIMARY} disabled={busy || (draft === "answer" && note.trim().length === 0)}>
              {busy ? "Saving…" : draft === "decline" ? "Decline" : "Send answer"}
            </button>
            <button
              type="button"
              className={SECONDARY}
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setNote("");
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error !== null ? (
        <p role="alert" className="mt-1.5 text-2xs leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** Opens the task in BB Tasks, the same route Opsdesk links to. */
function TaskLink({ taskKey, onNavigate }: { taskKey: string; onNavigate: () => void }) {
  return (
    <a
      href={`/plugins/tasks/tasks/task/${encodeURIComponent(taskKey)}`}
      onClick={onNavigate}
      title={`Open ${taskKey} in Tasks`}
      translate="no"
      className="rounded-sm font-mono tabular-nums underline decoration-dotted decoration-sidebar-foreground/40 underline-offset-2 hover:text-sidebar-foreground/95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
    >
      {taskKey}
    </a>
  );
}

function DueLabel({ row }: { row: DecisionRow }) {
  if (row.dueDate === null) return null;
  const day = formatDay(row.dueDate);
  if (row.hasDefaulted) return <span className="text-destructive">Defaulted {day}</span>;
  if (row.isOverdue) return <span className="text-destructive">Overdue since {day}</span>;
  return <span>Due {day}</span>;
}

function Empty({ title, detail }: { title: string; detail: ReactNode }) {
  return (
    <div className="mx-1.5 mt-2 flex flex-col items-center rounded-lg border border-dashed border-sidebar-border px-4 py-6 text-center">
      <span className="mb-2 flex size-8 items-center justify-center rounded-md bg-sidebar-accent/60 text-sidebar-foreground/73">
        <Icon name="Inbox" className="size-4" />
      </span>
      <p className="text-xs font-medium text-sidebar-foreground/95">{title}</p>
      <p className="mt-1 text-2xs leading-4 text-sidebar-foreground/73">{detail}</p>
    </div>
  );
}

/** A due date is a calendar day, so it is formatted without a timezone shift. */
function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: year === new Date().getFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}
