import assert from "node:assert/strict";
import test from "node:test";
import { isPublicAddress, pinnedLookup } from "./domain-readiness";

test("accepts globally routable IPv4 and IPv6 addresses", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("rejects private, reserved, translated, benchmark, and malformed addresses", () => {
  for (const address of [
    "127.0.0.1", "10.0.0.1", "100.64.0.1", "192.0.0.8", "198.18.0.1",
    "::1", "::ffff:127.0.0.1", "64:ff9b:1::1", "2001:2::1", "2001:db8::1",
    "fec0::1", "fc00::1", "fe80::1", "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("pins HTTPS lookup to the previously validated address and family", () => {
  const lookup = pinnedLookup("203.0.114.7", 4);
  lookup("customer.example", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "203.0.114.7");
    assert.equal(family, 4);
  });
});