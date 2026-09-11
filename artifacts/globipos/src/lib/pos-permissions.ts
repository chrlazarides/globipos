/**
 * POS Route Permission Helpers
 *
 * Two distinct access tiers exist for POS routes:
 *
 *  isPosStaff — the cashier tier. Grants access to the live register and
 *               card-terminal pages only. Staff can ring up sales but cannot
 *               configure or inspect the POS system.
 *
 *  isPosAdmin — the management tier. Required for all POS configuration and
 *               reporting screens (locations, terminals, layouts, orders,
 *               promotions, returns, shifts, sync-monitor, download). Only
 *               admin and superuser roles qualify.
 *
 * Keeping these checks here (rather than inline per-route) means a single
 * edit is enough to change who can reach which tier, and the intent is
 * obvious to anyone reading App.tsx.
 */

interface MinimalUser {
  role: string;
}

/** True for admin and superuser — may access POS management screens. */
export function isPosAdmin(user: MinimalUser | null | undefined): boolean {
  return user?.role === "admin" || user?.role === "superuser";
}

/**
 * True for all authenticated roles (staff, admin, superuser) — may access
 * the cashier-facing register and card-terminal screens.
 */
export function isPosStaff(user: MinimalUser | null | undefined): boolean {
  return (
    user?.role === "staff" ||
    user?.role === "admin" ||
    user?.role === "superuser"
  );
}
