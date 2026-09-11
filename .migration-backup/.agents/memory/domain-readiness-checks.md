---
name: Safe domain readiness checks
description: Security and concurrency rules for checking customer deployment hostnames before activation.
---

Resolve a deployment hostname first, reject every private or reserved result, then pin the HTTPS connection to one validated address while retaining the original hostname for SNI and certificate verification. Do not validate DNS and then let the HTTP client resolve independently.

**Why:** Independent resolution permits DNS rebinding to an internal address. On Node, an explicitly selected address family is also needed so the custom single-address lookup callback is used consistently.

**How to apply:** Use this for any server-side customer-hostname probe. Do not follow redirects as part of readiness checks. Keep Node `net.BlockList` IPv4 and IPv6 rules in separate instances; mixed-family rules can classify ordinary IPv4 addresses as IPv4-mapped IPv6.

Persist a readiness result only when the profile routing still matches the routing that was checked. Activation and routing/status updates must also use conditional writes against the state they validated.

**Why:** Network probes create a race window. Without compare-and-set predicates, an old successful check or concurrent status update can leave a new, unchecked hostname active.

**How to apply:** Treat connected results as short-lived evidence, reset them on routing changes, and reject conflicting writes so the operator reloads current state.