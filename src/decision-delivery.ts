/** Delivered, or recorded before Opsdesk tracked delivery: nothing for the owner to do. */
export function isSettledDelivery(delivery: { readonly outcome: string } | null): boolean {
  return delivery === null || delivery.outcome === "delivered" || delivery.outcome === "already-recorded";
}
