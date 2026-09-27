import assert from "node:assert/strict";
import test from "node:test";
import { applyDns, planDns, type RequestedDns } from "./godaddy-dns";

const input: RequestedDns = {
  hostname: "sample.globipos.shop",
  address: "8.8.8.8",
  txtName: "_replit.sample.globipos.shop",
  txtValue: "verification-example",
};

function fakeDns(existing: Record<string, unknown[]> = {}) {
  const writes: unknown[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const request = new URL(String(url));
    assert.equal(request.hostname, "api.godaddy.com");
    assert.equal(options?.headers && (options.headers as Record<string, string>).Authorization, "Bearer test-token");
    if (options?.method === "POST") {
      writes.push(JSON.parse(String(options.body)));
      return new Response("{}", { status: 201 });
    }
    return Response.json({ items: existing[request.searchParams.get("name") || ""] || [], links: [] });
  };
  return { fetcher, writes };
}

test("previews and creates only missing A and TXT records", async () => {
  const dns = fakeDns();
  const preview = await planDns(input, "test-token", dns.fetcher);
  assert.deepEqual(preview.records.map(record => record.action), ["create", "create"]);
  assert.deepEqual(dns.writes, []);
  await applyDns(input, "test-token", dns.fetcher);
  assert.deepEqual(dns.writes, [
    { type: "A", name: "sample", data: "8.8.8.8", ttl: 600 },
    { type: "TXT", name: "_replit.sample", data: "verification-example", ttl: 600 },
  ]);
});

test("repeated setup does not write existing matching records", async () => {
  const dns = fakeDns({
    sample: [{ type: "A", name: "sample", data: "8.8.8.8" }],
    "_replit.sample": [{ type: "TXT", name: "_replit.sample", data: "verification-example" }],
  });
  const result = await applyDns(input, "test-token", dns.fetcher);
  assert.deepEqual(result.records.map(record => record.action), ["already_present", "already_present"]);
  assert.equal(dns.writes.length, 0);
});

test("A and TXT may safely share the same hostname", async () => {
  const dns = fakeDns({ sample: [
    { type: "A", name: "sample", data: "8.8.8.8" },
    { type: "TXT", name: "sample", data: "verification-example" },
  ] });
  const result = await applyDns({ ...input, txtName: input.hostname }, "test-token", dns.fetcher);
  assert.deepEqual(result.records.map(record => record.action), ["already_present", "already_present"]);
  assert.equal(dns.writes.length, 0);
});

test("conflicting records block all writes", async () => {
  const dns = fakeDns({ "_replit.sample": [{ type: "TXT", name: "_replit.sample", data: "different-customer" }] });
  await assert.rejects(applyDns(input, "test-token", dns.fetcher), /existing DNS record/);
  assert.equal(dns.writes.length, 0);
});

test("refuses names outside the selected hostname and non-public IPs", async () => {
  const dns = fakeDns();
  await assert.rejects(planDns({ ...input, txtName: "other.globipos.shop" }, "test-token", dns.fetcher), /selected customer hostname/);
  await assert.rejects(planDns({ ...input, address: "127.0.0.1" }, "test-token", dns.fetcher), /public IPv4/);
  assert.equal(dns.writes.length, 0);
});

test("refuses incomplete paginated DNS listings", async () => {
  const dns = fakeDns();
  const fetcher: typeof fetch = async () => Response.json({ items: [], links: [{ rel: "next" }] });
  await assert.rejects(applyDns(input, "test-token", fetcher), /verify all existing/);
  assert.equal(dns.writes.length, 0);
});