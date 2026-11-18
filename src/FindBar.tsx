import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** True when a key press belongs to a text field, so "/" must type a slash there. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

/**
 * Find any thread by its words. It sits under the tabs on every tab; while it
 * holds a query, the list below shows the matches instead of the tab's own
 * list. "/" focuses it from anywhere outside a text field, and Escape clears it.
 */
export function FindBar({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (typingIn(event.target) || document.querySelector("[role=dialog], [role=menu]") !== null) return;
      event.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="cs-find-bar relative mx-1.5 mt-1.5" data-find-bar="">
      <Icon
        name="Search"
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/50"
      />
      <input
        ref={input}
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (query !== "") onChange("");
            else input.current?.blur();
          }
        }}
        aria-label="Find a thread"
        placeholder="Find a thread  /"
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "block h-7 w-full rounded-md border border-sidebar-border bg-transparent pl-7 text-xs text-sidebar-foreground",
          "placeholder:text-sidebar-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
          "[&::-webkit-search-cancel-button]:hidden max-md:h-9 pointer-coarse:h-9",
          query === "" ? "pr-2" : "pr-7",
        )}
      />
      {query !== "" ? (
        <button
          type="button"
          aria-label="Clear search"
          title="Clear search"
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
          className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <Icon name="X" aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
