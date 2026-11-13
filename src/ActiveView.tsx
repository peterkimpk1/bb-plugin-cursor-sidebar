import { useCallback, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { AnimatedList } from "./AnimatedList";
import { ThreadRow, type TreeContext } from "./ThreadTree";
import { MachineGlyph } from "./MachineGlyph";
import {
  ACTIVE_KINDS,
  ACTIVE_KIND_LABEL,
  activeContext,
  activeGroupTree,
  machineKind,
  type ActiveEntry,
  type ActiveKind,
  type MachineKind,
} from "./active";
import { flattenShelf, type ProjectSectionData } from "./forest";

export const ACTIVE_SECTION_ID = "active";

interface ActiveGroup {
  kind: ActiveKind;
  count: number;
  section: ProjectSectionData;
  holders: ReadonlySet<string>;
  inShelf: ReadonlySet<string>;
  descendants: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** How many of the kind's threads run on each machine, most first. */
  machines: readonly MachineCount[];
}

interface MachineCount {
  name: string;
  kind: MachineKind | null;
  count: number;
}

/** Kinds whose heading also counts threads per machine. */
const MACHINE_COUNT_KINDS: ReadonlySet<ActiveKind> = new Set(["working"]);

function countMachines(
  group: readonly ActiveEntry[],
  machineOf: (thread: PluginSidebarThread) => string | null,
): MachineCount[] {
  const counts = new Map<string, number>();
  for (const { thread } of group) {
    const name = machineOf(thread);
    if (name !== null) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, kind: machineKind(name), count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function descendantsOf(children: ReadonlyMap<string, readonly PluginSidebarThread[]>) {
  const result = new Map<string, PluginSidebarThread[]>();
  const walk = (id: string, seen: Set<string>): PluginSidebarThread[] => {
    const known = result.get(id);
    if (known !== undefined) return known;
    const below: PluginSidebarThread[] = [];
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      below.push(child, ...walk(child.id, seen));
    }
    result.set(id, below);
    return below;
  };
  for (const id of children.keys()) walk(id, new Set([id]));
  return result;
}

/**
 * The Active view: the threads that matter now, under a plain heading per
 * kind. Within a kind, a child sits under its nearest ancestor of the same
 * kind, and workers that share an off-list parent (a bot desk) sit under that
 * parent drawn muted, so related work reads as one family instead of rows
 * scattered by update time. Rows are the tree's own ThreadRow, so open, pin,
 * archive, folding and the menus behave as they do in the tree.
 */
export function ActiveView({
  entries,
  ctx,
  botNameOf,
  parentTitleOf,
  projectNameOf,
  pinnedOf,
  threadOf,
  machineOf,
}: {
  entries: readonly ActiveEntry[];
  /** A context whose rows speak only for themselves: no subtree status, no drag. */
  ctx: TreeContext;
  botNameOf: (threadId: string) => string | null;
  parentTitleOf: (thread: PluginSidebarThread) => string | null;
  projectNameOf: (thread: PluginSidebarThread) => string | null;
  /** The family's lifted pin state, which the row's pin toggle flips. */
  pinnedOf: (threadId: string) => boolean;
  /** Any sidebar thread by id, for ancestors outside the Active list. */
  threadOf: (threadId: string) => PluginSidebarThread | undefined;
  /** The short name of the machine a thread runs on, or null. */
  machineOf: (thread: PluginSidebarThread) => string | null;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // One machine in focus fades the other machines' rows; clicking it again shows all.
  const [focusedMachine, setFocusedMachine] = useState<string | null>(null);
  const toggleMachine = useCallback((name: string) => {
    setFocusedMachine((current) => (current === name ? null : name));
  }, []);
  const toggle = useCallback((threadId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(threadId)) next.add(threadId);
      return next;
    });
  }, []);

  const groups = useMemo<ActiveGroup[]>(() => {
    const byKind = new Map<ActiveKind, ActiveEntry[]>();
    for (const entry of entries) {
      const group = byKind.get(entry.kind);
      if (group === undefined) byKind.set(entry.kind, [entry]);
      else group.push(entry);
    }
    return ACTIVE_KINDS.flatMap((kind) => {
      const group = byKind.get(kind);
      if (group === undefined) return [];
      const tree = activeGroupTree(group, threadOf);
      const section: ProjectSectionData = {
        id: `${ACTIVE_SECTION_ID}-${kind}`,
        name: ACTIVE_KIND_LABEL[kind],
        known: true,
        personal: false,
        members: tree.members,
        forest: { parent: tree.parent, children: tree.children },
        shelfById: new Map(tree.members.map((thread) => [thread.id, "active" as const])),
        byShelf: { active: tree.members, settled: [] },
        scopeIds: new Map(),
      };
      return [
        {
          kind,
          count: group.length,
          section,
          holders: tree.holders,
          inShelf: new Set(tree.members.map((thread) => thread.id)),
          descendants: descendantsOf(tree.children),
          machines: MACHINE_COUNT_KINDS.has(kind) ? countMachines(group, machineOf) : [],
        },
      ];
    });
  }, [entries, machineOf, threadOf]);

  if (entries.length === 0) {
    return (
      <div className="mx-1.5 mt-2 flex flex-col items-center rounded-lg border border-dashed border-sidebar-border px-4 py-6 text-center">
        <span className="mb-2 flex size-8 items-center justify-center rounded-md bg-sidebar-accent/60 text-sidebar-foreground/73">
          <Icon name="CircleCheck" className="size-4" />
        </span>
        <p className="text-xs font-medium text-sidebar-foreground/95">All quiet</p>
        <p className="mt-1 text-2xs leading-4 text-sidebar-foreground/73">
          Nothing needs you, is running, or failed, and no thread changed in the last 2 hours.
        </p>
      </div>
    );
  }

  return (
    /* Each kind is its own block so a thread changing kind slides from one
       heading to the next, and an emptied heading leaves on the same curve. */
    <AnimatedList as="div" className="flex flex-col">
      {groups.map((group) => (
        <ActiveGroupBlock
          key={group.kind}
          group={group}
          ctx={ctx}
          collapsed={collapsed}
          onToggle={toggle}
          botNameOf={botNameOf}
          parentTitleOf={parentTitleOf}
          projectNameOf={projectNameOf}
          pinnedOf={pinnedOf}
          machineOf={machineOf}
          focusedMachine={focusedMachine}
          onToggleMachine={toggleMachine}
        />
      ))}
    </AnimatedList>
  );
}

function ActiveGroupBlock({
  group,
  ctx,
  collapsed,
  onToggle,
  botNameOf,
  parentTitleOf,
  projectNameOf,
  pinnedOf,
  machineOf,
  focusedMachine,
  onToggleMachine,
}: {
  group: ActiveGroup;
  ctx: TreeContext;
  collapsed: ReadonlySet<string>;
  onToggle: (threadId: string) => void;
  botNameOf: (threadId: string) => string | null;
  parentTitleOf: (thread: PluginSidebarThread) => string | null;
  projectNameOf: (thread: PluginSidebarThread) => string | null;
  pinnedOf: (threadId: string) => boolean;
  machineOf: (thread: PluginSidebarThread) => string | null;
  focusedMachine: string | null;
  onToggleMachine: (name: string) => void;
}) {
  const { kind, section, holders, inShelf } = group;
  // The focus applies where its counts are, and only while that machine is listed here.
  const focus =
    focusedMachine !== null && group.machines.some((machine) => machine.name === focusedMachine)
      ? focusedMachine
      : null;
  const onFocused = (thread: PluginSidebarThread): boolean =>
    holders.has(thread.id)
      ? (group.descendants.get(thread.id) ?? []).some((child) => machineOf(child) === focus)
      : machineOf(thread) === focus;
  const groupCtx = useMemo<TreeContext>(() => {
    const parents = [...section.forest.children.keys()];
    return {
      ...ctx,
      expandedParents: new Set(parents.filter((id) => !collapsed.has(id))),
      onToggleChildren: onToggle,
      descendantsById: group.descendants,
    };
  }, [collapsed, ctx, group.descendants, onToggle, section]);
  const rows = useMemo(
    () => flattenShelf(section, "active", (id) => groupCtx.expandedParents.has(id)),
    [groupCtx.expandedParents, section],
  );
  const kindWord = ACTIVE_KIND_LABEL[kind].toLowerCase();

  return (
    <section aria-label={ACTIVE_KIND_LABEL[kind]} data-active-kind={kind} className="mt-2 first:mt-0">
      <h3 className="cs-heading flex min-h-7 items-center gap-1.5 py-1 pl-3 pr-2 text-xs font-medium text-sidebar-foreground/73">
        {ACTIVE_KIND_LABEL[kind]}
        <span className="tabular-nums text-sidebar-foreground/50">{group.count}</span>
        {group.machines.length > 0 ? (
          <span
            data-machine-counts
            role="group"
            className="ml-0.5 flex items-center gap-0.5 tabular-nums"
            aria-label={group.machines.map((machine) => `${machine.count} on ${machine.name}`).join(", ")}
          >
            {group.machines.map((machine) => {
              const pressed = focus === machine.name;
              const label = pressed
                ? `${machine.count} on ${machine.name}. Show all machines`
                : `${machine.count} on ${machine.name}. Fade the other machines`;
              return (
                <button
                  key={machine.name}
                  type="button"
                  data-machine-count={machine.name}
                  aria-pressed={pressed}
                  aria-label={label}
                  title={label}
                  onClick={() => onToggleMachine(machine.name)}
                  className={cn(
                    "inline-flex h-5 items-center rounded px-1 transition-colors",
                    "hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/95",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
                    pressed
                      ? "bg-sidebar-accent text-sidebar-foreground/95"
                      : focus !== null
                        ? "text-sidebar-foreground/35"
                        : "text-sidebar-foreground/50",
                  )}
                >
                  {machine.kind === null ? `${machine.name} ` : <MachineGlyph kind={machine.kind} />}
                  {machine.count}
                </button>
              );
            })}
          </span>
        ) : null}
      </h3>
      <AnimatedList className="flex flex-col">
        {rows.map((row) => {
          const { thread } = row;
          const isHolder = holders.has(thread.id);
          const nested = section.forest.parent.get(thread.id) != null;
          const held = (section.forest.children.get(thread.id) ?? []).length;
          const machineName = machineOf(thread);
          const kind = machineKind(machineName);
          // A known machine shows as a glyph; an unknown one keeps its name in the line.
          const machineText = kind === null ? machineName : null;
          return (
            <ThreadRow
              key={thread.id}
              row={row}
              section={section}
              shelf={isHolder ? "settled" : "active"}
              inShelf={inShelf}
              ctx={groupCtx}
              rootPinned={pinnedOf(thread.id)}
              inFolderId={null}
              pinVisible
              dimmed={focus !== null && !onFocused(thread)}
              machine={kind !== null && machineName !== null ? { kind, name: machineName } : null}
              context={
                isHolder
                  ? [botNameOf(thread.id), projectNameOf(thread), machineText, `${held} ${kindWord}`]
                      .filter(Boolean)
                      .join(" · ")
                  : activeContext({
                      botName: botNameOf(thread.id),
                      // Nesting already shows the parent.
                      parentTitle: nested ? null : parentTitleOf(thread),
                      projectName: projectNameOf(thread),
                      machineName: machineText,
                    })
              }
            />
          );
        })}
      </AnimatedList>
    </section>
  );
}
