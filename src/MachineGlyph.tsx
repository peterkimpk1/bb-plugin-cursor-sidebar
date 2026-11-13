import type { MachineKind } from "./active";

/**
 * The machine a thread runs on, as a glyph sized to the row's second line.
 * Hugeicons has no Mac mini, so the Mini is a squat box with its status light;
 * the laptop is Hugeicons' Laptop.
 */
export function MachineGlyph({ kind }: { kind: MachineKind }) {
  return (
    <svg aria-hidden="true" data-machine={kind} className="cs-machine-glyph" viewBox="0 0 24 24" fill="none">
      {kind === "mini" ? (
        <>
          <rect x="2.75" y="8.25" width="18.5" height="9" rx="2.75" stroke="currentColor" strokeWidth="1.75" />
          <path d="M5.5 20.25h13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="17.5" cy="12.75" r="1.1" fill="currentColor" />
        </>
      ) : (
        <>
          <path d="M20.5 16.5v-8c0-2.36 0-3.54-.73-4.27-.73-.73-1.91-.73-4.27-.73h-7c-2.36 0-3.54 0-4.27.73-.73.73-.73 1.91-.73 4.27v8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21.98 20.5H2.02a.5.5 0 0 1-.46-.73L3.5 16.5h17l1.94 3.27a.5.5 0 0 1-.46.73Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
