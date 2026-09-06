/** Ambiguous failures must retain the persisted event key for exactly-once replay. */
export function shouldRetryScanFailure(status?: number): boolean {
  if (status == null) return true;
  if (status === 401 || status === 403 || status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}