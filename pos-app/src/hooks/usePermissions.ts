/**
 * Permission layer — checks the current cashier's role before allowing actions.
 */
import { useState, useCallback } from "react";
import type { CashierSession } from "../types";

const SUPERVISOR_PERMISSIONS = new Set([
  "void_line", "price_override", "discount", "promo_code", "end_shift",
]);
const MANAGER_PERMISSIONS = new Set([
  "void_order", "refund", "manage_cashiers", "reports", "fallback_rules",
  "open_drawer", "manual_promo",
]);

export interface UsePermissionsReturn {
  can: (action: string) => boolean;
  needsSupervisorPin: (action: string) => boolean;
  needsManagerPin: (action: string) => boolean;
  pinPromptAction: string | null;
  pinPromptRole: "supervisor" | "manager" | null;
  requestAction: (action: string, onGranted: () => void) => void;
  onPinGranted: () => void;
  onPinDenied: () => void;
}

export function usePermissions(session: CashierSession | null): UsePermissionsReturn {
  const [pinPromptAction, setPinPromptAction] = useState<string | null>(null);
  const [pinPromptRole, setPinPromptRole] = useState<"supervisor" | "manager" | null>(null);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

  const can = useCallback(
    (action: string): boolean => {
      if (!session) return false;
      const role = session.role;
      if (role === "manager") return true;
      if (role === "supervisor" && !MANAGER_PERMISSIONS.has(action)) return true;
      return session.permissions.includes(action);
    },
    [session]
  );

  const needsSupervisorPin = useCallback(
    (action: string): boolean => {
      if (!session) return true;
      if (session.role === "manager" || session.role === "supervisor") return false;
      return SUPERVISOR_PERMISSIONS.has(action);
    },
    [session]
  );

  const needsManagerPin = useCallback(
    (action: string): boolean => {
      if (!session) return true;
      if (session.role === "manager") return false;
      return MANAGER_PERMISSIONS.has(action);
    },
    [session]
  );

  const requestAction = useCallback(
    (action: string, onGranted: () => void) => {
      if (needsManagerPin(action)) {
        setPinPromptAction(action);
        setPinPromptRole("manager");
        setPendingCallback(() => onGranted);
      } else if (needsSupervisorPin(action)) {
        setPinPromptAction(action);
        setPinPromptRole("supervisor");
        setPendingCallback(() => onGranted);
      } else {
        onGranted();
      }
    },
    [needsManagerPin, needsSupervisorPin]
  );

  const onPinGranted = useCallback(() => {
    pendingCallback?.();
    setPinPromptAction(null);
    setPinPromptRole(null);
    setPendingCallback(null);
  }, [pendingCallback]);

  const onPinDenied = useCallback(() => {
    setPinPromptAction(null);
    setPinPromptRole(null);
    setPendingCallback(null);
  }, []);

  return {
    can,
    needsSupervisorPin,
    needsManagerPin,
    pinPromptAction,
    pinPromptRole,
    requestAction,
    onPinGranted,
    onPinDenied,
  };
}
