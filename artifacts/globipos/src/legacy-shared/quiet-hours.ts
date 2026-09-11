export const DEFAULT_STORE_TIME_ZONE = "Europe/Nicosia";

export function calculateServerClockOffset(
  serverTime: string | number | Date,
  requestStartedAt: number,
  responseReceivedAt: number,
): number {
  const serverTimeMs = new Date(serverTime).getTime();
  if (
    !Number.isFinite(serverTimeMs) ||
    !Number.isFinite(requestStartedAt) ||
    !Number.isFinite(responseReceivedAt) ||
    responseReceivedAt < requestStartedAt
  ) {
    throw new Error("Could not calculate server clock offset");
  }
  return serverTimeMs - (requestStartedAt + responseReceivedAt) / 2;
}

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

export function isWithinQuietHoursInTimeZone(
  startHour: number,
  endHour: number,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const hour = getHourInTimeZone(now, timeZone);
  if (startHour === endHour) return false;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
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
  for (let minuteOffset = 0; minuteOffset <= 26 * 60; minuteOffset++) {
    if (!isWithinQuietHoursInTimeZone(startHour, endHour, timeZone, candidate)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error(`Could not find the end of quiet hours in ${timeZone}`);
}

export function getServerCorrectedNow(serverClockOffsetMs: number, deviceNowMs: number = Date.now()): Date {
  return new Date(deviceNowMs + serverClockOffsetMs);
}