export const CREDIT_APPROVE_PERMISSION = "customer_credit_approve";

/** Capability flags are not modules: they never restrict or count toward module access. */
export const moduleKeys = (permissions: string[] | null | undefined): string[] =>
  (permissions ?? []).filter(k => k !== CREDIT_APPROVE_PERMISSION);

export function canAccessModule(role: string, permissions: string[] | null | undefined, module: string): boolean {
  if (role === "admin" || role === "superuser") return true;
  const modules = moduleKeys(permissions);
  return modules.length === 0 || modules.includes(module);
}

export const hasCreditApprovePermission = (permissions: string[] | null | undefined) =>
  (permissions ?? []).includes(CREDIT_APPROVE_PERMISSION);

/** Replace module selection while keeping the credit-approval grant. */
export function withModules(current: string[], modules: string[]): string[] {
  return hasCreditApprovePermission(current) ? [...moduleKeys(modules), CREDIT_APPROVE_PERMISSION] : moduleKeys(modules);
}

export function withCreditApprove(current: string[], grant: boolean): string[] {
  const modules = moduleKeys(current);
  return grant ? [...modules, CREDIT_APPROVE_PERMISSION] : modules;
}
