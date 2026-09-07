import assert from "node:assert/strict";
import test from "node:test";
import {
  getHourInTimeZone,
  getQuietHoursEndInTimeZone,
  getTimeZoneRegionLabel,
  isValidIanaTimeZone,
  isWithinQuietHoursInTimeZone,
} from "./quiet-hours";

test("uses the store time zone instead of the device time zone", () => {
  const instant = new Date("2026-01-15T20:30:00Z");

  assert.equal(getHourInTimeZone(instant, "Europe/Nicosia"), 22);
  assert.equal(isWithinQuietHoursInTimeZone(22, 8, "Europe/Nicosia", instant), true);
  assert.equal(isWithinQuietHoursInTimeZone(22, 8, "America/New_York", instant), false);
});

test("IANA time-zone rules apply daylight-saving changes automatically", () => {
  assert.equal(getHourInTimeZone(new Date("2026-01-15T20:30:00Z"), "Europe/Nicosia"), 22);
  assert.equal(getHourInTimeZone(new Date("2026-07-15T19:30:00Z"), "Europe/Nicosia"), 22);

  // Cyprus jumps from 02:59 to 04:00 local time on this spring transition.
  assert.equal(getHourInTimeZone(new Date("2026-03-29T00:30:00Z"), "Europe/Nicosia"), 2);
  assert.equal(getHourInTimeZone(new Date("2026-03-29T01:30:00Z"), "Europe/Nicosia"), 4);
});

test("finds the quiet-hours end in the account zone across DST", () => {
  const beforeSpringJump = new Date("2026-03-28T21:30:00Z");
  assert.equal(
    getQuietHoursEndInTimeZone(22, 8, "Europe/Nicosia", beforeSpringJump).toISOString(),
    "2026-03-29T05:00:00.000Z",
  );
});

test("a skipped quiet-hours end expires at the first instant after the spring gap", () => {
  const beforeSpringJump = new Date("2026-03-28T21:30:00Z");
  assert.equal(
    getQuietHoursEndInTimeZone(22, 3, "Europe/Nicosia", beforeSpringJump).toISOString(),
    "2026-03-29T01:00:00.000Z",
  );
});

test("a repeated fall-back hour stays quiet through both occurrences", () => {
  const beforeFallBack = new Date("2026-10-24T20:30:00Z");
  assert.equal(
    getQuietHoursEndInTimeZone(22, 4, "Europe/Nicosia", beforeFallBack).toISOString(),
    "2026-10-25T02:00:00.000Z",
  );
});

test("rejects values that are not IANA time zones", () => {
  assert.equal(isValidIanaTimeZone("Europe/Nicosia"), true);
  assert.equal(isValidIanaTimeZone("Not/AZone"), false);
});

test("formats a human-friendly region label", () => {
  assert.equal(getTimeZoneRegionLabel("America/New_York"), "New York (America)");
  assert.equal(getTimeZoneRegionLabel("Europe/Nicosia"), "Nicosia (Europe)");
});