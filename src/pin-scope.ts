/**
 * The pin decisions shared by the sidebar's row consumer and the row menu. Kept
 * pure and SDK-free so the exact writes a toggle performs, and the label the
 * menu shows, are exercised directly against the production functions.
 */

export interface PinWrite {
  threadId: string;
  pinned: boolean;
}

/** Whether a row may be pinned. An archived row never pins. */
export function pinAllowed(archived: boolean): boolean {
  return !archived;
}

/**
 * The native writes one pin toggle performs: the toggled thread, and only it.
 * Its parent, children and siblings keep their own pins.
 */
export function planPinWrites(input: { threadId: string; pinned: boolean }): readonly PinWrite[] {
  return [{ threadId: input.threadId, pinned: input.pinned }];
}

/** The row-menu label for a pin toggle on that row's own thread. */
export function pinActionLabel(isPinned: boolean): string {
  return isPinned ? "Unpin" : "Pin";
}
