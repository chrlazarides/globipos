export const DEFAULT_STORE_TIME_ZONE = "Europe/Nicosia";

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function getTimeZoneRegionLabel(timeZone: string): string {
  const parts = timeZone.split("/");
  if (parts.length < 2) return timeZone.replaceAll("_", " ");
  const city = parts.at(-1)!.replaceAll("_", " ");
  const region = parts.slice(0, -1).join(" / ").replaceAll("_", " ");
  return `${city} (${region})`;
}

export function getHourInTimeZone(now: Date, timeZone: string): number {
  const hourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).find((part) => part.type === "hour");

  const hour = Number.parseInt(hourPart?.value ?? "", 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error(`Could not determine the current hour in ${timeZone}`);
  }
  return hour;
}

export function getQuietHoursEndInTimeZone(
  startHour: number,
  endHour: number,
  timeZone: string,
  now: Date = new Date(),
): Date {
  const candidate = new Date(now);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  // Find the first real instant outside the window. This makes a skipped end
  // hour end at the first instant after the DST gap and keeps a repeated hour
  // quiet through both occurrences.
  for (let minuteOffset = 0; minuteOffset <= 26 * 60; minuteOffset++) {
    if (!isWithinQuietHoursInTimeZone(startHour, endHour, timeZone, candidate)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error(`Could not find the end of quiet hours in ${timeZone}`);
}

export function isWithinQuietHoursInTimeZone(
  startHour: number,
  endHour: number,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const hour = getHourInTimeZone(now, timeZone);
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}