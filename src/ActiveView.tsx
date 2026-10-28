import { useMemo } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { AnimatedList } from "./AnimatedList";
import { ThreadRow, type TreeContext } from "./ThreadTree";
import { ACTIVE_KINDS, ACTIVE_KIND_LABEL, activeContext, type ActiveEntry, type ActiveKind } from "./active";
import type { ProjectSectionData } from "./forest";

export const ACTIVE_SECTION_ID = "active";

/**
 * The Active view: one flat list of the threads that matter now, children
 * included, under a plain heading per kind. Rows are the tree's own ThreadRow
 * on a forest with no edges, so open, pin, archive and the menus behave as
 * they do in the tree, but nothing nests or folds.
 */
export function ActiveView({
  entries,
  ctx,
  botNameOf,
  parentTitleOf,
  projectNameOf,
  pinnedOf,
}: {
  entries: readonly ActiveEntry[];
  /** A context whose rows speak only for themselves: no subtree status, no drag. */
  ctx: TreeContext;
  botNameOf: (threadId: string) => string | null;
  parentTitleOf: (thread: PluginSidebarThread) => string | null;
  projectNameOf: (thread: PluginSidebarThread) => string | null;
  /** The family's lifted pin state, which the row's pin toggle flips. */
  pinnedOf: (threadId: string) => boolean;
}) {
  const section = useMemo<ProjectSectionData>(() => {
    const members = entries.map((entry) => entry.thread);
    return {
      id: ACTIVE_SECTION_ID,
      name: "Active",
      known: true,
      personal: false,
      members,
      forest: { parent: new Map(), children: new Map() },
      shelfById: new Map(members.map((thread) => [thread.id, "active" as const])),
      byShelf: { active: members, settled: [] },
      scopeIds: new Map(),
    };
  }, [entries]);
  const inShelf = useMemo(() => new Set(section.members.map((thread) => thread.id)), [section]);
  const groups = useMemo(() => {
    const byKind = new Map<ActiveKind, ActiveEntry[]>();
    for (const entry of entries) {
      const group = byKind.get(entry.kind);
      if (group === undefined) byKind.set(entry.kind, [entry]);
      else group.push(entry);
    }
    return ACTIVE_KINDS.flatMap((kind) => {
      const group = byKind.get(kind);
      return group === undefined ? [] : [{ kind, entries: group }];
    });
  }, [entries]);

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
      {groups.map(({ kind, entries: group }) => (
        <section key={kind} aria-label={ACTIVE_KIND_LABEL[kind]} data-active-kind={kind} className="mt-2 first:mt-0">
          <h3 className="cs-heading flex min-h-7 items-center gap-1.5 py-1 pl-3 pr-2 text-xs font-medium text-sidebar-foreground/73">
            {ACTIVE_KIND_LABEL[kind]}
            <span className="tabular-nums text-sidebar-foreground/50">{group.length}</span>
          </h3>
          <AnimatedList className="flex flex-col">
            {group.map(({ thread }) => (
              <ThreadRow
                key={thread.id}
                row={{ thread, depth: 0, guides: [] }}
                section={section}
                shelf="active"
                inShelf={inShelf}
                ctx={ctx}
                rootPinned={pinnedOf(thread.id)}
                inFolderId={null}
                context={activeContext({
                  botName: botNameOf(thread.id),
                  parentTitle: parentTitleOf(thread),
                  projectName: projectNameOf(thread),
                })}
              />
            ))}
          </AnimatedList>
        </section>
      ))}
    </AnimatedList>
  );
}
