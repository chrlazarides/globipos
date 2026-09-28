import assert from "node:assert/strict";
import test from "node:test";
import type { TerminalConfig } from "../types.ts";
import { isSameTerminalIdentity } from "./terminal-identity.ts";

const baseConfig: TerminalConfig = {
  server_url: "https://store.example.com",
  terminal_code: "T001",
  terminal_id: "terminal-1",
  terminal_name: "Till 1",
  location_id: "location-1",
  location_name: "Main",
  price_level: 1,
};

test("terminal identity includes canonical server origin, terminal code, and registered tenant ids", () => {
  assert.equal(isSameTerminalIdentity(baseConfig, {
    ...baseConfig,
    server_url: "https://store.example.com/",
    terminal_code: "t001",
  }), true);
  assert.equal(isSameTerminalIdentity(baseConfig, { ...baseConfig, server_url: "https://other.example.com" }), false);
  assert.equal(isSameTerminalIdentity(baseConfig, { ...baseConfig, terminal_code: "T002" }), false);
  assert.equal(isSameTerminalIdentity(baseConfig, { ...baseConfig, terminal_id: "terminal-2" }), false);
  assert.equal(isSameTerminalIdentity(baseConfig, { ...baseConfig, location_id: "location-2" }), false);
});