import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
/** The Active filter is a window preference too, stored the same way. */
const ACTIVE_KEY = "bb-plugin-cursor-sidebar:active-filter:v1";

function useWindowPreference<T extends string>(
  key: string,
  parse: (value: string | null) => T | null,
  fallback: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return parse(window.sessionStorage.getItem(key)) ?? parse(window.localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, value);
      window.localStorage.setItem(key, value);
    } catch {
      // Best-effort; the in-memory value still drives this mount.
    }
  }, [key, value]);
  return [value, setValue];
}

const parseTab = (value: string | null): SidebarTab | null =>
  value === "threads" || value === "bots" ? value : null;

export function useSidebarTab(): [SidebarTab, (tab: SidebarTab) => void] {
  return useWindowPreference(TAB_KEY, parseTab, "threads");
}

const parseOnOff = (value: string | null): "on" | "off" | null =>
  value === "on" || value === "off" ? value : null;

export function useActiveFilter(): [boolean, (on: boolean) => void] {
  const [value, setValue] = useWindowPreference(ACTIVE_KEY, parseOnOff, "off");
  const set = useCallback((on: boolean) => setValue(on ? "on" : "off"), [setValue]);
  return [value === "on", set];
}

/**
 * The Active chip beside the tab switch. Pressed, its face takes the same
 * raised surface the selected tab's thumb has, so the two read as one control
 * strip. The count turns to the needs-you tone while anything is waiting.
 */
export function ActiveFilterChip({
  on,
  onChange,
  count,
  needsYou,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  count: number;
  needsYou: number;
}) {
  const label = `Active: ${count} thread${count === 1 ? "" : "s"}${needsYou > 0 ? `, ${needsYou} need${needsYou === 1 ? "s" : ""} you` : ""}`;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={on ? "Show the full list" : "Show only active threads"}
      onClick={() => onChange(!on)}
      className="cs-active-chip group/chip flex shrink-0 rounded-md bg-sidebar-accent/50 p-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
    >
      <span
        className={cn(
          "flex min-h-6 items-center gap-1 rounded-[5px] px-2 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none max-md:min-h-9 pointer-coarse:min-h-9",
          on
            ? "bg-sidebar text-sidebar-foreground shadow-sm"
            : "text-sidebar-foreground/73 group-hover/chip:text-sidebar-foreground/90",
        )}
      >
        Active
        <span
          aria-hidden="true"
          className={needsYou > 0 ? "cs-needs-you-count" : "cs-active-count"}
        >
          {count}
        </span>
      </span>
    </button>
  );
}

/**
 * Threads | Bots. A sliding thumb marks the selection, travelling on the same
 * curve the lists use when rows move, so the switch reads as part of the list.
 */
export function SidebarTabSwitch({
  tab,
  onChange,
  badges,
  accessory,
}: {
  tab: SidebarTab;
  onChange: (tab: SidebarTab) => void;
  /** Optional count per tab, e.g. bots that need you. */
  badges?: Partial<Record<SidebarTab, number>>;
  /** A control that sits at the switch's trailing edge (the Active chip). */
  accessory?: ReactNode;
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
    <div className="flex items-center gap-1 px-2 pt-2 pb-1">
      <div
        role="tablist"
        aria-label="Sidebar view"
        onKeyDown={onKeyDown}
        className="cs-tab-switch relative grid min-w-0 flex-1 grid-cols-2 rounded-md bg-sidebar-accent/50 p-0.5"
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
      {accessory}
    </div>
  );
}
