export type TransferLocation = { id: string; name: string; active?: boolean };

// The terminal API already filters inactive shops and returns {id, name}.
// Also accept an explicit active flag for callers using richer location data.
export function transferDestinations(locations: TransferLocation[], sourceId: string): TransferLocation[] {
  return locations.filter(location => location.id !== sourceId && location.active !== false);
}