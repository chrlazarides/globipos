import http from "node:http";
import https from "node:https";
import net from "node:net";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";

const forbidden = () => { throw new Error("Network forbidden in money-path tests"); };
globalThis.fetch = forbidden;
http.request = http.get = https.request = https.get = forbidden;
net.connect = net.createConnection = net.Socket.prototype.connect = forbidden;
let sequence = 0;
const uuid = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
crypto.randomUUID = uuid;
syncBuiltinESMExports();
Object.defineProperty(globalThis, "crypto", { configurable: true, value: { randomUUID: uuid } });
const DateOriginal = Date;
export const now = "2026-10-12T09:00:00.000Z";
globalThis.Date = class extends DateOriginal {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return DateOriginal.parse(now); }
};
globalThis.__moneyPromotions = [];
if (!process.env.MONEY_PRODUCTION_MODULE) throw new Error("Run node scripts/test-money-paths.mjs");
export const app = await import(process.env.MONEY_PRODUCTION_MODULE);

// Explicit, individually documented quarantine; opt in to reproduce unchanged
// desired assertions. No catch-all conversion of unexpected failures to skips.
export const known = (name, reason, fn) => test(name, {
  skip: process.env.MONEY_KNOWN_FAILURES === "1" ? false : `KNOWN FAILURE: ${reason}; reproduce with MONEY_KNOWN_FAILURES=1`,
}, fn);
