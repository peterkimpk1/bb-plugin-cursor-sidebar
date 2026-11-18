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
  machineKind,
  type ActiveEntry,
  type ActiveKind,
  type MachineKind,
} from "./active";
import type { ProjectSectionData } from "./forest";

export const ACTIVE_SECTION_ID = "active";

interface ActiveGroup {
  kind: ActiveKind;
  count: number;
  section: ProjectSectionData;
  inShelf: ReadonlySet<string>;
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

/** Active shows only each kind's own threads, as independent rows without folding. */
export function ActiveView({
  entries,
  ctx,
  botNameOf,
  parentTitleOf,
  projectNameOf,
  pinnedOf,
  machineOf,
}: {
  entries: readonly ActiveEntry[];
  /** A context whose rows speak only for themselves: no subtree status, no drag. */
  ctx: TreeContext;
  botNameOf: (threadId: string) => string | null;
  parentTitleOf: (thread: PluginSidebarThread) => string | null;
  projectNameOf: (thread: PluginSidebarThread) => string | null;
  /** The row's own pin state. */
  pinnedOf: (threadId: string) => boolean;
  /** The short name of the machine a thread runs on, or null. */
  machineOf: (thread: PluginSidebarThread) => string | null;
}) {
  // One machine in focus fades the other machines' rows; clicking it again shows all.
  const [focusedMachine, setFocusedMachine] = useState<string | null>(null);
  const toggleMachine = useCallback((name: string) => {
    setFocusedMachine((current) => (current === name ? null : name));
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
      const members = group.map(({ thread }) => thread);
      const section: ProjectSectionData = {
        id: `${ACTIVE_SECTION_ID}-${kind}`,
        name: ACTIVE_KIND_LABEL[kind],
        known: true,
        personal: false,
        members,
        forest: { parent: new Map(), children: new Map() },
        shelfById: new Map(members.map((thread) => [thread.id, "active" as const])),
        byShelf: { active: members, settled: [] },
        scopeIds: new Map(),
      };
      return [
        {
          kind,
          count: members.length,
          section,
          inShelf: new Set(members.map((thread) => thread.id)),
          machines: MACHINE_COUNT_KINDS.has(kind) ? countMachines(group, machineOf) : [],
        },
      ];
    });
  }, [entries, machineOf]);

  if (entries.length === 0) {
    return (
      <div className="mx-1.5 mt-2 flex flex-col items-center rounded-lg border border-dashed border-sidebar-border px-4 py-6 text-center">
        <span className="mb-2 flex size-8 items-center justify-center rounded-md bg-sidebar-accent/60 text-sidebar-foreground/73">
          <Icon name="CircleCheck" className="size-4" />
        </span>
        <p className="text-xs font-medium text-sidebar-foreground/95">All quiet</p>
        <p className="mt-1 text-2xs leading-4 text-sidebar-foreground/73">
          Nothing is running, needs you, or has an unread failure.
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
  botNameOf: (threadId: string) => string | null;
  parentTitleOf: (thread: PluginSidebarThread) => string | null;
  projectNameOf: (thread: PluginSidebarThread) => string | null;
  pinnedOf: (threadId: string) => boolean;
  machineOf: (thread: PluginSidebarThread) => string | null;
  focusedMachine: string | null;
  onToggleMachine: (name: string) => void;
}) {
  const { kind, section, inShelf } = group;
  // The focus applies where its counts are, and only while that machine is listed here.
  const focus =
    focusedMachine !== null && group.machines.some((machine) => machine.name === focusedMachine)
      ? focusedMachine
      : null;

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
        {section.members.map((thread) => {
          const machineName = machineOf(thread);
          const machineType = machineKind(machineName);
          // A known machine shows as a glyph; an unknown one keeps its name in the line.
          const machineText = machineType === null ? machineName : null;
          return (
            <ThreadRow
              key={thread.id}
              row={{ thread, depth: 0, guides: [] }}
              section={section}
              shelf="active"
              inShelf={inShelf}
              ctx={ctx}
              rootPinned={pinnedOf(thread.id)}
              inFolderId={null}
              pinVisible
              dimmed={focus !== null && machineName !== focus}
              machine={machineType !== null && machineName !== null ? { kind: machineType, name: machineName } : null}
              context={activeContext({
                botName: botNameOf(thread.id),
                parentTitle: parentTitleOf(thread),
                projectName: projectNameOf(thread),
                machineName: machineText,
              })}
            />
          );
        })}
      </AnimatedList>
    </section>
  );
}
