import { useQuery } from "@tanstack/react-query";
import type { SystemSetting } from "@shared/schema";

const defaults = ["Price Level 1", "Price Level 2", "Price Level 3", "Price Level 4", "Price Level 5"];

export function usePriceLevels(): string[] {
  const { data: settings } = useQuery<SystemSetting[]>({
    queryKey: ["/api/settings"],
  });

  if (!settings) return defaults;

  const names = defaults.map((def, i) => {
    const setting = settings.find(s => s.key === `price_level_${i + 1}`);
    return setting?.value || def;
  });

  return names;
}
