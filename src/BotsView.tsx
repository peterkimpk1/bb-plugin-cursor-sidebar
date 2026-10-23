import { useEffect, useMemo, useRef, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  useRpc,
  type NewThreadComposerProps,
  type NewThreadRequest,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AnimatedList } from "./AnimatedList";
import { Drawer } from "./Drawer";
import { ShelfList, type TreeContext } from "./ThreadTree";
import { SidebarActions } from "./SidebarActions";
import { ShowMoreButton } from "./ShowMoreButton";
import { CONVERSATION_PAGE_SIZE, DEFAULT_INACTIVE_CONVERSATIONS, planConversations } from "./conversations";
import type { PersistentIds } from "./collapse";
import type { ProjectSectionData } from "./forest";
import type { BotSummary, cursorSidebarRpcContract } from "./server";
import { useBotAvatars, type BotAvatarMarkup, type BotsState } from "./useBots";
import {
  needsYou,
  avatarInk,
  botFacts,
  botInitial,
  botLaunchProjectId,
  botOpenTarget,
  buildBotSection,
  type BotFacts,
} from "./bots";

type ReadyBots = Extract<BotsState, { status: "ready" }>;

export interface BotModel {
  bot: BotSummary;
  facts: BotFacts;
  section: ProjectSectionData;
}

/** Per-bot facts and sections, in bots_list order. */
export function useBotModels(
  bots: BotsState,
  membersByBotId: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): BotModel[] {
  return useMemo(() => {
    if (bots.status !== "ready") return [];
    return bots.bots.map((bot) => {
      const members = membersByBotId.get(bot.id) ?? [];
      return { bot, facts: botFacts(members), section: buildBotSection(bot, members) };
    });
  }, [bots, membersByBotId]);
}

/**
 * The Bots tab: one row per bots-sidebar bot. A row opens the bot's main
 * conversation, its chevron reveals the bot's conversations drawn by the same
 * ShelfList/ThreadRow the Threads tab uses, and its "+" starts a conversation
 * through bots-sidebar so the new thread is bound to the bot.
 */
export function BotsView({
  bots,
  models,
  ctx,
  expandedBots,
  onRefresh,
}: {
  bots: BotsState;
  models: readonly BotModel[];
  ctx: TreeContext;
  expandedBots: PersistentIds;
  onRefresh: () => void;
}) {
  const actions = useSidebarThreadActions();
  const [composing, setComposing] = useState<BotSummary | null>(null);
  const appearanceKey = bots.status === "ready" ? JSON.stringify(bots.bots.map((bot) => [bot.id, bot.avatar])) : "";
  const avatars = useBotAvatars(appearanceKey, AVATAR_SIZE);

  if (bots.status === "loading") {
    return (
      <p role="status" className="px-3 py-6 text-center text-xs text-sidebar-foreground/73">
        Loading bots…
      </p>
    );
  }
  if (bots.status === "unavailable") {
    return (
      <BotsEmpty
        title="Bots Sidebar isn’t running"
        detail="Install or enable the Bots Sidebar plugin to list its bots here."
      />
    );
  }
  if (models.length === 0) {
    return <BotsEmpty title="No bots yet" detail="Bots you create in Bots Sidebar show up here." />;
  }

  const startConversation = (bot: BotSummary) => {
    // bots-sidebar answered this list, so its conversation_create is reachable;
    // the dialog falls back to the native composer if the call itself fails.
    setComposing(bot);
  };

  return (
    <>
      <AnimatedList as="div" className="flex flex-col gap-px">
        {models.map((model) => (
          <BotRow
            key={model.bot.id}
            model={model}
            ctx={ctx}
            open={expandedBots.ids.has(model.bot.id)}
            onToggle={() => expandedBots.toggle(model.bot.id)}
            onOpen={(threadId) => {
              actions.open(threadId);
              ctx.onNavigate();
            }}
            onNewConversation={() => startConversation(model.bot)}
            avatar={avatars[model.bot.id] ?? null}
          />
        ))}
      </AnimatedList>
      {composing !== null ? (
        <BotConversationDialog
          bot={composing}
          bots={bots}
          onClose={() => setComposing(null)}
          onCreated={(threadId) => {
            setComposing(null);
            onRefresh();
            actions.open(threadId);
            ctx.onNavigate();
          }}
          onFallback={(projectId) => {
            setComposing(null);
            actions.openNewThread({ ...(projectId ? { projectId } : {}), focusPrompt: true });
            ctx.onNavigate();
          }}
        />
      ) : null}
    </>
  );
}

function BotsEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-1.5 mt-2 flex flex-col items-center rounded-lg border border-dashed border-sidebar-border px-4 py-6 text-center">
      <span className="mb-2 flex size-8 items-center justify-center rounded-md bg-sidebar-accent/60 text-sidebar-foreground/73">
        <Icon name="Bot" className="size-4" />
      </span>
      <p className="text-xs font-medium text-sidebar-foreground/95">{title}</p>
      <p className="mt-1 text-2xs leading-4 text-sidebar-foreground/73">{detail}</p>
    </div>
  );
}

/** bots-sidebar's character, at the size its own sidebar uses for compact rows. */
const AVATAR_SIZE = 26;

function BotAvatar({ bot, working, markup }: { bot: BotSummary; working: boolean; markup: BotAvatarMarkup[string] | null }) {
  if (markup) {
    // The SVG comes from bots-sidebar's server (its own avatar component, rendered
    // statically); its classes drive the idle and working animations in app.css.
    return (
      <span
        aria-label={working ? "Working" : undefined}
        role={working ? "img" : undefined}
        className="cs-bot-character flex size-[26px] shrink-0 items-center justify-center"
        dangerouslySetInnerHTML={{ __html: working ? markup.working : markup.idle }}
      />
    );
  }
  const color = bot.avatar?.color ?? null;
  return (
    <span className="cs-bot-avatar relative flex size-5 shrink-0 items-center justify-center">
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold leading-none",
          color === null && "bg-sidebar-accent text-sidebar-foreground/90",
        )}
        style={color === null ? undefined : { backgroundColor: color, color: avatarInk(color) }}
      >
        {botInitial(bot.name)}
      </span>
      {working ? (
        <span
          role="img"
          aria-label="Working"
          className="pointer-events-none absolute -bottom-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-sidebar"
        >
          <Icon name="Loading" aria-hidden="true" strokeWidth={1.5} className="size-3 animate-spin text-sidebar-foreground/73" />
        </span>
      ) : null}
    </span>
  );
}

function BotRow({
  model,
  ctx,
  open,
  onToggle,
  onOpen,
  onNewConversation,
  avatar,
}: {
  avatar: BotAvatarMarkup[string] | null;
  model: BotModel;
  ctx: TreeContext;
  open: boolean;
  onToggle: () => void;
  onOpen: (threadId: string) => void;
  onNewConversation: () => void;
}) {
  const { bot, facts, section } = model;
  const target = botOpenTarget(bot, facts.members, section);
  const ownsActive = ctx.activeThreadId !== null && facts.members.some((thread) => thread.id === ctx.activeThreadId);
  const isActive = target !== null && target === ctx.activeThreadId;
  const [limit, setLimit] = useState(DEFAULT_INACTIVE_CONVERSATIONS);
  useEffect(() => {
    if (!open) setLimit(DEFAULT_INACTIVE_CONVERSATIONS);
  }, [open]);
  const plan = useMemo(
    () => planConversations(section, { activeThreadId: ctx.activeThreadId, limit }),
    [ctx.activeThreadId, limit, section],
  );
  const count = facts.members.length;
  const disclosureLabel = `${open ? "Collapse" : "Expand"} ${bot.name}`;
  // The count includes children at any depth, so the badge itself opens the
  // conversation that is waiting, and its tooltip names every one.
  const waiting = facts.members.filter(needsYou);
  const needsLabel = `${facts.needsYou} conversation${facts.needsYou === 1 ? "" : "s"} need${facts.needsYou === 1 ? "s" : ""} you: ${waiting.map((thread) => thread.title || "Untitled").join(", ")}. Click to open${waiting.length > 1 ? " the first" : ""}.`;
  const openBot = () => {
    if (target !== null) onOpen(target);
    else onNewConversation();
  };

  return (
    <section aria-label={bot.name} className={cn(open && "mb-1.5")}>
      <SidebarActions
        label={bot.name}
        actions={[
          { label: target !== null ? "Open main conversation" : "Start a conversation", run: openBot },
          ...(count > 0 ? [{ label: open ? "Collapse conversations" : "Expand conversations", run: onToggle }] : []),
          { label: "New conversation", run: onNewConversation, separatorBefore: true },
        ]}
      >
        <div
          data-bot-row={bot.id}
          className={cn(
            "cs-bot-heading group/heading relative flex min-h-9 items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 max-md:min-h-12 pointer-coarse:min-h-12",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : ownsActive && !open
                ? "bg-sidebar-accent/30 hover:bg-sidebar-accent/60"
                : "hover:bg-sidebar-accent/60",
          )}
        >
          <button
            type="button"
            aria-label={disclosureLabel}
            aria-expanded={open}
            disabled={count === 0}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle();
            }}
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded text-sidebar-foreground/73 hover:text-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring disabled:invisible",
              "opacity-0 group-hover/heading:opacity-100 group-focus-within/heading:opacity-100 focus-visible:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100",
            )}
          >
            <Icon
              name="ChevronRight"
              className={cn(
                "size-3.5 transition-transform duration-150 ease-out motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
          </button>
          <BotAvatar bot={bot} working={facts.working} markup={avatar} />
          <button
            type="button"
            title={target !== null ? `Open ${bot.name}` : `Start a conversation with ${bot.name}`}
            aria-current={isActive ? "true" : undefined}
            onClick={openBot}
            className="flex min-h-7 min-w-0 flex-1 flex-col items-start justify-center rounded py-0.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <span className={cn("w-full truncate text-sm leading-5 text-sidebar-foreground/95", facts.unread && "font-medium")}>
              {bot.name}
            </span>
            {bot.role.trim() ? (
              <span className="w-full truncate text-2xs leading-none text-sidebar-foreground/73">{bot.role}</span>
            ) : null}
          </button>
          {facts.needsYou > 0 ? (
            <button
              type="button"
              className="cs-needs-you-count"
              aria-label={needsLabel}
              title={needsLabel}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (waiting[0]) onOpen(waiting[0].id);
              }}
            >
              {facts.needsYou}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`New conversation with ${bot.name}`}
            title={`New conversation with ${bot.name}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onNewConversation();
            }}
            className={cn(
              "cs-project-new flex size-5 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/73 hover:text-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
              "max-md:size-9 pointer-coarse:size-9",
              "opacity-0 group-hover/heading:opacity-100 group-focus-within/heading:opacity-100 focus-visible:opacity-100 max-md:opacity-100 pointer-coarse:opacity-100",
            )}
          >
            <Icon name="Plus" className="size-3.5 max-md:size-5 pointer-coarse:size-5" />
          </button>
        </div>
      </SidebarActions>
      {/* Conversations hang under the bot: their status column lines up with the avatar. */}
      <Drawer open={open && count > 0} className="pl-4">
        <ShelfList section={section} shelf="active" ctx={ctx} grouped={false} keepIds={plan.visible} />
        <ShowMoreButton
          hiddenConversations={plan.hiddenConversations}
          onShowMore={() => setLimit((current) => current + CONVERSATION_PAGE_SIZE)}
        />
      </Drawer>
    </section>
  );
}

/**
 * The host's own new-thread composer in a dialog. Submitting hands the request
 * to bots-sidebar's conversation_create (through this plugin's server), which
 * binds the thread to the bot and adds the bot's identity. Seeds follow
 * bots-sidebar: the project the bot owns, else the personal project on the
 * bot's machine, plus the bot's launch preset.
 */
function BotConversationDialog({
  bot,
  bots,
  onClose,
  onCreated,
  onFallback,
}: {
  bot: BotSummary;
  bots: ReadyBots;
  onClose: () => void;
  onCreated: (threadId: string) => void;
  onFallback: (projectId: string | null) => void;
}) {
  const rpc = useRpc<typeof cursorSidebarRpcContract>();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Captured once so a background poll never re-seeds the user's choices.
  const [launch] = useState(() => {
    const { projectId, owned } = botLaunchProjectId(bot, bots.projectOwners, bots.personalProjectId);
    const hostId = bot.hostId ?? undefined;
    const environment: NewThreadRequest["environment"] | undefined = hostId === undefined
      ? undefined
      : owned
        ? bot.launchPreset?.workspace === "worktree"
          ? { type: "host", hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } }
          : { type: "host", hostId, workspace: { type: "unmanaged", path: null } }
        : { type: "host", hostId, workspace: { type: "personal" } };
    const execution = bot.launchPreset?.execution ?? null;
    const seeds: Partial<NewThreadComposerProps> = {
      ...(bot.launchPreset?.initialPrompt ? { initialPrompt: bot.launchPreset.initialPrompt } : {}),
      ...(execution
        ? {
            defaultProviderId: execution.providerId,
            defaultModel: execution.model,
            defaultReasoningLevel: execution.reasoningLevel as NewThreadComposerProps["defaultReasoningLevel"],
            ...(execution.serviceTier === undefined
              ? {}
              : { defaultServiceTier: execution.serviceTier as NewThreadComposerProps["defaultServiceTier"] }),
            ...(execution.permissionMode === null ? {} : { defaultPermissionMode: execution.permissionMode }),
          }
        : {}),
    };
    return { projectId, environment, seeds };
  });

  return (
    <Dialog open onOpenChange={(next) => { if (!next && !submitting.current) onClose(); }}>
      <DialogContent className="cs-create-dialog max-h-[90vh] overflow-y-auto sm:max-w-3xl" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>New conversation with {bot.name}</DialogTitle>
          <DialogDescription>
            Bots Sidebar starts it with {bot.name}’s identity and memory, and files it under the bot.
          </DialogDescription>
        </DialogHeader>
        <NewThreadComposer
          {...launch.seeds}
          {...(launch.projectId ? { defaultProjectId: launch.projectId } : {})}
          {...(launch.environment ? { defaultEnvironment: launch.environment } : {})}
          layout="document"
          focusRequest={1}
          draftKey={`bb-plugin-cursor-sidebar:bot-conversation:${bot.id}`}
          onSubmit={async (request) => {
            if (submitting.current) throw new Error("A conversation is already being created.");
            submitting.current = true;
            setPending(true);
            setError(null);
            try {
              const { threadId } = await rpc.call("botsConversationCreate", {
                botId: bot.id,
                request: request as unknown as Record<string, never>,
              });
              onCreated(threadId);
            } catch (cause) {
              const message = cause instanceof Error ? cause.message : String(cause);
              setError(message);
              toast.error(`Could not start a conversation with ${bot.name}`, { description: message });
              throw cause;
            } finally {
              submitting.current = false;
              setPending(false);
            }
          }}
        />
        {error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              onClick={() => onFallback(launch.projectId)}
              className="rounded-md px-2 py-1 text-xs font-medium text-sidebar-foreground/90 underline-offset-2 hover:underline"
            >
              Use the native composer instead
            </button>
          </div>
        ) : null}
        {pending ? <p role="status" className="text-xs text-muted-foreground">Creating conversation…</p> : null}
      </DialogContent>
    </Dialog>
  );
}
