import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SidebarTab = "threads" | "bots";

const TABS: readonly { id: SidebarTab; label: string }[] = [
  { id: "threads", label: "Threads" },
  { id: "bots", label: "Bots" },
];

/**
 * The selected tab is a window preference, kept beside the plugin's other
 * client-side layout prefs. sessionStorage holds it per window, so two windows
 * can sit on different tabs; localStorage seeds a new window with the last
 * choice made anywhere.
 */
const TAB_KEY = "bb-plugin-cursor-sidebar:sidebar-tab:v1";

function parseTab(value: string | null): SidebarTab | null {
  return value === "threads" || value === "bots" ? value : null;
}

function readTab(): SidebarTab {
  try {
    return parseTab(window.sessionStorage.getItem(TAB_KEY)) ?? parseTab(window.localStorage.getItem(TAB_KEY)) ?? "threads";
  } catch {
    return "threads";
  }
}

export function useSidebarTab(): [SidebarTab, (tab: SidebarTab) => void] {
  const [tab, setTab] = useState<SidebarTab>(readTab);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(TAB_KEY, tab);
      window.localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Best-effort; the in-memory tab still drives this mount.
    }
  }, [tab]);
  return [tab, setTab];
}

/**
 * Threads | Bots. A sliding thumb marks the selection, travelling on the same
 * curve the lists use when rows move, so the switch reads as part of the list.
 */
export function SidebarTabSwitch({
  tab,
  onChange,
  badges,
}: {
  tab: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  /** Optional count per tab, e.g. bots that need you. */
  badges?: Partial<Record<SidebarTab, number>>;
}) {
  const refs = useRef(new Map<SidebarTab, HTMLButtonElement>());
  const index = TABS.findIndex((entry) => entry.id === tab);
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? TABS.length - 1
            : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
      const target = TABS[next]!;
      onChange(target.id);
      refs.current.get(target.id)?.focus();
    },
    [index, onChange],
  );
  return (
    <div className="px-2 pt-2 pb-1">
      <div
        role="tablist"
        aria-label="Sidebar view"
        onKeyDown={onKeyDown}
        className="cs-tab-switch relative grid grid-cols-2 rounded-md bg-sidebar-accent/50 p-0.5"
      >
        <span
          aria-hidden="true"
          className="cs-tab-thumb pointer-events-none absolute inset-y-0.5 left-0.5 rounded-[5px] bg-sidebar shadow-sm"
          style={{ width: `calc((100% - 4px) / ${TABS.length})`, transform: `translateX(${index * 100}%)` }}
        />
        {TABS.map((entry) => {
          const selected = entry.id === tab;
          const badge = badges?.[entry.id] ?? 0;
          return (
            <button
              key={entry.id}
              ref={(node) => {
                if (node) refs.current.set(entry.id, node);
                else refs.current.delete(entry.id);
              }}
              type="button"
              role="tab"
              id={`cs-tab-${entry.id}`}
              aria-selected={selected}
              aria-controls={`cs-tabpanel-${entry.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(entry.id)}
              className={cn(
                "relative z-10 flex min-h-6 items-center justify-center gap-1 rounded-[5px] px-2 text-xs font-medium transition-colors duration-150 ease-out motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring max-md:min-h-9 pointer-coarse:min-h-9",
                selected ? "text-sidebar-foreground" : "text-sidebar-foreground/73 hover:text-sidebar-foreground/90",
              )}
            >
              {entry.label}
              {badge > 0 ? (
                <span
                  className="cs-needs-you-count"
                  aria-label={`${badge} need${badge === 1 ? "s" : ""} you`}
                >
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
