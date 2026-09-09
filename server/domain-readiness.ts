import dns from "dns/promises";
import https from "https";
import net from "net";

export type DomainCheck = {
  hostname: string;
  role: "customer" | "pos" | "eshop";
  status: "connected" | "failed";
  dnsAddresses: string[];
  reason: string;
};

const blockedIpv4Addresses = new net.BlockList();
const blockedIpv6Addresses = new net.BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.31.196.0", 24], ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:1::1", 128],
  ["2001:1::2", 128], ["2001:2::", 48], ["2001:3::", 32], ["2001:4:112::", 48],
  ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16],
  ["2620:4f:8000::", 48], ["3fff::", 20], ["5f00::", 16], ["fc00::", 7],
  ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string) {
  const family = net.isIP(address);
  if (family === 0) return false;
  return family === 4
    ? !blockedIpv4Addresses.check(address, "ipv4")
    : !blockedIpv6Addresses.check(address, "ipv6");
}

export function pinnedLookup(address: string, family: number) {
  return (_hostname: string, _options: unknown, callback: (error: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
    callback(null, address, family);
  };
}

function checkHttps(hostname: string, address: string, family: number) {
  return new Promise<{ statusCode?: number }>((resolve, reject) => {
    const request = https.request({
      hostname,
      servername: hostname,
      port: 443,
      path: "/",
      method: "HEAD",
      timeout: 8000,
      family: family as 4 | 6,
      lookup: pinnedLookup(address, family),
      headers: { "user-agent": "GlobiPOS-Domain-Check/1.0" },
    }, response => {
      response.resume();
      resolve({ statusCode: response.statusCode });
    });
    request.on("timeout", () => request.destroy(new Error("HTTPS request timed out")));
    request.on("error", reject);
    request.end();
  });
}

export async function checkDomain(hostname: string, role: DomainCheck["role"]): Promise<DomainCheck> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    const addresses = Array.from(new Set(records.map(record => record.address)));
    if (!addresses.length) throw new Error("DNS returned no addresses");
    if (addresses.some(address => !isPublicAddress(address))) {
      throw new Error("DNS resolves to a private or reserved address");
    }
    const response = await checkHttps(hostname, records[0].address, records[0].family);
    return {
      hostname,
      role,
      status: "connected",
      dnsAddresses: addresses,
      reason: `DNS and HTTPS are ready${response.statusCode ? ` (HTTP ${response.statusCode})` : ""}`,
    };
  } catch (error) {
    return {
      hostname,
      role,
      status: "failed",
      dnsAddresses: [],
      reason: error instanceof Error ? error.message : "Domain check failed",
    };
  }
}