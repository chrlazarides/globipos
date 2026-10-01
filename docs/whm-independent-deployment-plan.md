# GlobiPOS independent WHM deployments

Status: proposed architecture and implementation plan. Full WHM administrator/root access confirmed by the owner; server capabilities and SSH/API access remain to be verified.

## Goal

Run independent customer installations on WHM-managed hosting. Extend the existing Deployment menu into a central control centre for provisioning, API connections, release management, health monitoring and technical support. The owner's superuser support identity must be available in every installation.

Each customer installation must continue normal operation if the control centre is unavailable. An unavailable or stale monitoring connection must never be mistaken for a healthy installation.

### Master and customer operating roles

The owner agreed to develop in this workspace and operate a dedicated published master with independent customer installations. Maintain shared source code with explicitly enforced Master and Customer roles, rather than maintaining separate customer code copies.

The existing default published instance can become the master only if dedicated to central administration. If it already serves live trading or customer business data, preserve it and establish a separate master. Customer installations must not expose fleet administration, inherit WHM credentials or depend on the development workspace.

## Current foundation and gaps

The application already has deployment profiles, domains and domain checks, current/target Back Office and POS versions, monitoring credentials, a heartbeat receiver, incident history and rollout records. The provider choices currently cover manual, GitHub and Replit operation.

Actual rollout dispatch is not attached: creating a rollout currently leaves it queued. WHM provisioning, remote installation/update execution and fleet-wide support login still need implementation. Existing cPanel/VPS packages are starting points, not proof of compatibility with the target WHM server.

## 1. Isolation and hosting

- One customer per cPanel account, with its own non-root application user, application directory, PostgreSQL database and database user.
- Separate customer secrets, sessions, uploaded files, integration configuration and backup destination.
- Deploy the API and built Back Office, web POS and storefront assets as a compatible release.
- Preserve customer domains, company settings, branding, stock locations and business data during updates.
- Keep the control centre's customer registry, WHM credentials and fleet-wide operations out of customer database copies.
- The control centre holds deployment metadata and support telemetry, not a shared operational customer database.
- Multiple accounts on one WHM server provide account isolation, not separate-server fault isolation or high availability. Allow installations to be assigned to different WHM servers.

### Configurable server profiles

The owner requires flexibility to deploy on another server. Support multiple registered WHM/cPanel servers from the outset; do not hard-code one hosting endpoint, root identity, directory, domain or runtime.

Each server profile contains:

- Stable server ID, display name, provider/region metadata and lifecycle state.
- WHM HTTPS hostname and port, verified TLS/connection policy, administrator or delegated API identity and secure credential references.
- Optional approved SSH connection and access policy, if the selected installation method needs it.
- Verified WHM/cPanel, operating system, Node.js, PostgreSQL and application-hosting capabilities; last verification time and permission limitations.
- Supported deployment adapter, account/package defaults, account-relative application directory conventions and resource limits.
- DNS provider/zone references, domain defaults, SSL configuration and off-server backup policy.
- Connection status, supported operations and maintenance/retirement state.

Secret values remain server-side and are not embedded in profiles exported to customer installations. Credentials and capabilities are specific to each server; full administrator access on the current server does not establish access or capabilities on another server.

The create-installation workflow selects a server, validates compatibility and creates or explicitly links the correct cPanel account. Support selecting an existing permitted account as well as provisioning a new one. Discover account-specific requirements rather than assuming that all accounts inherit identical runtime or database settings.

Account identity is scoped by server ID plus cPanel account identity; the same username on another server is not the same account. Keep the customer's logical deployment ID, domains and history separate from the physical hosting assignment.

Use one release format with hosting adapters for verified supported runtimes. Differences in Passenger/process management, directory layouts, CPU architecture and required PostgreSQL extensions belong in capability checks and adapters, not customer-specific forks.

Select a server explicitly for each new installation. Never silently move existing customers because the preferred server changes. Editing a connection endpoint is not a migration; changes require revalidation, and pending jobs must not silently retarget to another host or account.

Retiring a server stops new placements and schedules approved moves; it does not automatically suspend customer applications. Block removal of hosting records still needed by active installations or unresolved operations, and retain historical hosting assignments.

### Moving an existing installation

Provide a separate, auditable migration operation, not an ordinary server dropdown edit:

1. Select the target server/account and validate permissions, runtime, PostgreSQL restore compatibility, capacity, domains and backup/recovery requirements.
2. Stage the current compatible release on the target. Keep target checkouts, scheduled workers and integrations inactive while testing.
3. Agree a maintenance window. Stop source writes and background processing, drain or account for in-flight work, then capture a consistent database/files/configuration backup.
4. Transfer and restore customer data and approved configuration securely. Preserve business IDs, stock, pairing configuration, idempotency records and queued work; do not copy WHM provisioning secrets.
5. Validate the target application, files, integrations and support identity. Enrol the new hosting instance with unique management credentials tied to the same logical deployment.
6. Confirm the source is fenced against writes before activating the target. If source fencing cannot be established, do not activate a second writable copy.
7. Switch the approved domains/routing and master hosting assignment. Keep customer-facing URLs stable where possible; stale DNS clients must not be allowed to write to the old database.
8. Verify health, terminal synchronisation and integrations; revoke old management credentials and retain the fenced source for an agreed recovery period. Cleanup requires explicit approval.

Rollback before target writes can reactivate the source under controlled routing. Once the target has accepted transactions, the old database is stale: moving DNS back alone is unsafe. A return migration requires fencing the target and transferring the latest data back before reopening the source.

Do not promise zero downtime. Preserve offline POS pending transactions and ensure they later sync only to the authoritative installation.

### Hosting capability gate

The owner has confirmed full WHM administrator/root access. Plan for administrator-led bootstrap and automated customer-account provisioning, rather than a reseller-only installation.

Before selecting the exact runtime and connecting automation, verify:

- SSH availability, API access and the dedicated automation identity's actual permitted account operations.
- WHM/cPanel version, operating system and supported account isolation.
- Maintained Node.js runtime compatible with the release, PostgreSQL availability and database provisioning permissions.
- Application Manager/Passenger or another host-supported Node.js process manager.
- Background job, scheduled task, filesystem permission and outbound HTTPS capabilities.
- Authoritative DNS provider, domain ownership, HTTPS/AutoSSL and inbound management access policy.
- Reliable encrypted backups stored outside the application server.

Test startup, ESM packaging, static asset paths, background tasks and restart behaviour on a pilot account. Do not assume that a generic PM2 startup script also works unchanged under Passenger.

### Administrator bootstrap and least privilege

- Use administrator access for the initial server prerequisites, approved service configuration and creation of isolated customer accounts.
- Require explicit approval before changing server-wide packages, Apache/Passenger configuration or existing hosting services.
- Create a dedicated automation connection with only the privileges needed for supported operations. Do not use or distribute the owner's root password.
- Keep WHM provisioning credentials exclusively in the central control centre, separate from each customer's management credentials.
- Run customer applications, background workers and release agents as their customer account users. Administrator access does not mean running GlobiPOS as root.
- Bootstrap one pilot account first. Do not change existing live customer installations or migrate production data during the capability audit.

## 2. Separate API responsibilities

### WHM server connection

Provision and inspect accounts and hosting resources using the permitted WHM APIs. Store credentials server-side, verify TLS, restrict privileges and caller IPs where the host supports it, and verify actual token permissions rather than assuming unrestricted API access.

### cPanel account connection

Configure account-level applications and supported hosting settings through cPanel UAPI or the appropriate WHM-mediated account API. A WHM API token is not automatically a direct cPanel UAPI token.

### GlobiPOS management connection

Use unique credentials or authenticated identities for each deployment. Bind requests to an exact deployment, scope monitoring separately from deployment operations, rotate/revoke credentials, and reject expired or replayed requests.

A small, separately supervised deployment agent performs allowlisted actions such as installing an approved release, reporting job progress, restarting the application and creating a backup. It operates as the customer account, not as root. Use the confirmed administrator access for initial agent installation and supervision setup, once server capabilities and the pilot approach are approved.

Do not expose arbitrary shell execution through the Deployment menu. Restrict remote targets and destinations to registered, validated hosts to prevent unintended internal-network access.

## 3. Deployment menu

### Fleet list

Show customer, deployment ID, assigned WHM server/account, domain, deployment state, health, last contact, installed/target versions and available updates.

Add a Servers section for connection profiles, verified capabilities, account inventory and maintenance/retirement status. Installation records distinguish current hosting, previous hosting and any planned migration target; provide filters by customer, server, environment and release.

### Deployment details

- Hosting: account, domains, certificates, application/runtime configuration and connection status.
- Versions: API, Back Office, web POS, installed POS/PDA clients where they report, deployment agent, database schema and release identifiers.
- Health: application readiness, database connectivity/latency, scheduled workers, storage/disk warnings and integration availability.
- Support: redacted recent errors with request IDs, relevant configuration, terminal last-sync times, pending synchronisation counts and diagnostic export.
- Backup: last successful backup, retention, restore-test status and recovery readiness.
- History: changes, deployment jobs, incidents, support sessions and operator audit trail.

Actions: validate connection, run preflight, deploy approved release, schedule update, restart service, create backup, download redacted diagnostics and open a support session.

Restore, account suspension/deletion and other destructive actions require separate explicit confirmation. Ordinary release rollback must not silently restore or delete customer data.

All displayed support dates/times use Europe/Nicosia. Secrets, tokens and unnecessary customer/payment data must not appear in telemetry or diagnostic exports.

## 4. Release and version management

- Build approved, immutable releases once from the existing source repository.
- Record release version, source revision, build identity, checksums/signature, runtime requirements, schema version and client compatibility.
- Keep actual reported versions separate from target versions and release-channel policy.
- Use stable/pilot channels, pinned customer versions and explicit maintenance windows.
- Run jobs asynchronously with durable status, idempotency, progress, retries and an audit trail. Never mark a queued request as a completed deployment.
- Bind each job to the approved server/account, connection revision and hosting instance. Server-profile changes invalidate or require explicit reapproval of affected pending jobs; do not reinterpret their targets at execution time.

### Update sequence

1. Check server capabilities, compatibility, disk space and current application/database state.
2. Produce and verify a recoverable customer backup.
3. Download and verify the approved release.
4. Stage it alongside the current release.
5. Apply reviewed, versioned database migrations when required; do not use a blind schema overwrite or import a fresh database over live data.
6. Activate the release and run readiness and functional smoke checks.
7. Report the actual active release and outcome to the control centre.

If activation fails, return to the previous application release only where the migrated schema remains compatible. Database restoration is a separate recovery operation with potential data loss and explicit approval.

WHM backend/web updates do not automatically update installed Windows/Android POS or PDA applications. Track their actual versions separately and preserve compatibility with offline devices and pending transactions.

## 5. Superuser support identity

- Provision a protected, clearly identified support-superuser identity in each customer installation, linked to the owner's central identity.
- Integrate support authentication with the existing application roles; do not replace ordinary customer/staff login merely to add support access.
- Require strong central authentication and MFA for support access.
- Open short-lived, single-use, deployment-specific support sessions. Do not copy one password, password hash or unrestricted long-lived token to every customer.
- Separate read-only monitoring from interactive superuser access.
- Record the support operator, reason, deployment, session lifetime and privileged actions. Allow central revocation and expiry.
- Prevent an ordinary customer administrator from modifying or impersonating the managed support identity.
- Provide a controlled emergency access procedure for control-centre outages, with unique per-deployment recovery credentials, secure storage and audited use.

Availability of the support identity must not become a hidden authentication bypass. Each installation validates the approved support authority and exact intended deployment.

## 6. Monitoring and support

- Authenticated heartbeats report versions and bounded health summaries on a configurable interval.
- Independently probe external reachability and application readiness; a self-reported heartbeat alone is insufficient.
- Distinguish healthy, degraded, failed, unreachable, stale and not-yet-connected states.
- Alert on missed contact, repeated application/database failures, failed updates, expiring certificates and missing backups.
- Use deduplication, recovery notifications and maintenance suppression so one incident does not produce repeated notifications.
- Connection failures or revoked credentials must be visible without exposing credential values.
- Limit logs and diagnostics to necessary support information, with redaction, size limits and retention policies.

### Standalone POS and PWA live sync status

The owner requires visible processing/synchronisation indicators in both the standalone POS and PWA, including transferred item counts and last-sync information. Define one shared status contract, with platform-appropriate persistence and execution. This is a planned requirement, not a claim that the installed applications already provide it.

#### Local indication

- Always-visible compact status on the POS screen, opening a detailed sync panel. Do not make staff leave checkout to discover a stalled or failed sync.
- Show device/network connectivity separately from verified application-server connectivity. Internet access or navigator online status alone does not establish a working server connection.
- Distinguish up to date, running, pending work, offline, unreachable server, retry waiting, partial failure, failed and interrupted/stale status. Derive these from the actual worker, queue and server observations, not a decorative animation.
- Show the active phase: connection check, catalog download, local save, pending transaction/audit upload, server confirmation or completion.
- Show elapsed time, last progress time, retry attempts and next retry where known. A stalled or abandoned operation must not spin indefinitely or remain marked running after restart.
- Provide Sync Now, supported retry controls and redacted diagnostics. Respect existing authorisation and offline-checkout rules; observing sync must not change transaction eligibility or introduce new financial actions.

#### Counts and timestamps

- Catalog records received, locally committed, updated/deactivated and rejected where the protocol can establish those counts; distinguish the last run from the number currently stored.
- Confirmed uploaded transactions and audit records, with separate pending and failed/rejected queue counts.
- Completed stock-transfer references and confirmed units moved, where relevant. Drafts, reservations and attempted requests are not completed movements.
- The label "transferred" must identify whether it means catalog records, acknowledged transactions or actual stock units; these are different operations and must not share an ambiguous counter.
- Use completed/total and a percentage only when the protocol supplies a reliable total. Otherwise show actual records/pages processed and the active phase without inventing a percentage.
- Keep last attempt, last verified server contact, last completed catalog sync, last confirmed transaction upload and last fully successful sync cycle separate.
- Persist successful timestamps and confirmed results across app/browser restarts. Store timestamps consistently and display them in Europe/Nicosia with clear age/freshness information.
- Update successful counters only after the required server acknowledgement and local persistence. Partial failures retain their pending records and previous success timestamps; retries of the same operation must not inflate totals.

#### Coordinator, recovery and reporting

- Use a single sync coordinator per device, with appropriate tab/window exclusion and shared status updates. Manual and automatic triggers must not launch overlapping copies of the same operation.
- Preserve resumable catalog checkpoints and outbox records. Recover interrupted runs safely; retry only eligible failures with bounded backoff and existing idempotency identities.
- Use lightweight revision/change checks and incremental or paginated transfers where supported, rather than repeatedly downloading the full catalog simply to produce a live indicator.
- Keep rejected work visible with a redacted reason. Never clear failed queues, recreate monetary actions or repeat stock movements merely to make the indicator green.
- Report bounded, authenticated device telemetry to that customer's installation. The installation relays necessary summaries to the master; POS devices do not receive fleet/WHM credentials or depend on master availability.
- Associate reports with deployment identity, physical hosting instance, device identity, installed build, run identity and ordering information. Delayed reports from an old run or migrated instance must not overwrite fresher active state.
- The customer device monitor and master show last received report, last successful sync, actual reported versions, pending/failed counts, current phase and recent errors. Label aged counts as last reported, not current verified values.
- A closed/sleeping PWA cannot be assumed to send continuous heartbeats or execute background jobs. Show stale/inactive device reporting separately from the customer application server being offline; the same distinction applies to sleeping standalone devices.

#### Current implementation baseline and prerequisites

The browser terminal currently has paginated catalog sync, local persistence and transaction/audit outboxes, but not the consolidated status contract above. Its catalog progress callback currently reports completion only, and outbox errors are logged rather than exposed as a complete persisted status model.

The active standalone POS build source must be established before implementation and release: native source is present under the migration backup, while the current top-level pos-app directory does not contain a complete source/build definition. Locate/recover the approved source and build process without treating a browser rebuild as an updated native installer. Both clients must be verified against the same observable sync semantics.

## 7. Ordered implementation

1. **Operating roles and capability specification:** define the dedicated Master/Customer boundaries, stable customer/deployment identities and multi-server profile model. Use the confirmed full administrator access for a read-only SSH/API and pilot-server capability audit; choose supported hosting adapters and recovery requirements.
2. **Independent installation baseline:** create one isolated pilot customer account, package adapter, database migration process, secrets and verified backup/restore procedure.
3. **WHM/cPanel connections:** add the WHM provider, multiple secure server profiles, account discovery/selection, capability checks and permitted provisioning operations. Server settings must not be global hard-coded defaults.
4. **Management agent and device sync monitoring:** establish the active standalone POS build source; implement the shared sync status contract, native/PWA coordinators and local indicators, authenticated device reporting, management-agent lifecycle and external checks.
5. **Support access:** add managed support identity, MFA-protected session launch, revocation, audit and emergency recovery.
6. **Release execution and dashboard:** wire rollout records to real execution; expose versions, installation health, per-device sync freshness/progress, support details, diagnostic exports and controlled update/rollback actions.
7. **Pilot, portability and staged rollout:** verify one non-trading/pilot installation, then prove a second supported server profile can deploy independently and complete a controlled test migration before expanding to approved customer installations.

These are ordered phases of one deployment-management programme, not independent parallel implementations.

## Acceptance checks

- Two customer accounts cannot access each other's databases, uploads, secrets or management actions.
- Customer trading does not depend on the control centre being reachable.
- Repeated deployment requests do not install or migrate twice.
- Unauthorised or expired management/support credentials are rejected.
- A support-superuser session opens only the selected deployment, expires and is auditable.
- Reported health and versions reflect real observations, including stale/disconnected devices.
- A failed update leaves an actionable status and a tested recovery path.
- Updates preserve customer data, branding and configuration; backups are restorable.
- Monitoring/diagnostics expose no secret credentials or unnecessary customer information.
- Installed POS/PDA devices and pending offline transactions remain compatible across a staged update.
- New installations can select a different WHM/cPanel server without customer code changes or disturbing existing installations.
- Identical cPanel usernames on different servers cannot mix credentials, jobs, customer records or monitoring results.
- Changing a preferred server or connection profile cannot silently move an installation or retarget a queued operation.
- A migration preserves the logical deployment identity/history and never leaves two writable copies active.
- A migration failure has a recovery path that preserves transactions accepted after cutover, rather than blindly reverting DNS to stale data.
- Both standalone POS and PWA show real phase/progress, confirmed record counts, queue failures and persisted channel-specific last-sync timestamps.
- Offline/unreachable, interrupted restart, slow/stalled requests, partial acknowledgements and failed local persistence cannot appear as successful completed syncs.
- Retried requests cannot inflate transferred counts or duplicate transactions/stock movements; pending data survives reloads and client updates.
- Manual and background sync triggers cannot overlap unsafely, including multiple PWA tabs.
- Closing/sleeping a device or losing its reporting connection produces stale/inactive device state in monitoring, not a false fresh/healthy sync claim.

## Implemented device sync reporting

- The standalone native source and the PWA now report actual catalog page/record saves, server-acknowledged queued bills and audit records, failed/pending work, per-channel sync times and contact/progress times. Catalog records do not represent physical stock transfers.
- Back Office **Sync Monitor** polls customer-local terminal reports. **Deployment Control → Customer POS sync reports** reads the master's stored, redacted summaries. A device report becomes stale after 45 seconds; installation contact is assessed separately.
- Customer-to-master reporting is opt-in, server-side only. Configure all three variables on the customer API service: `GLOBIPOS_MASTER_ORIGIN` (HTTPS origin, no path), `GLOBIPOS_DEPLOYMENT_ID` (enrolled UUID) and `GLOBIPOS_DEPLOYMENT_TOKEN` (that deployment's scoped credential, held as a server secret). Do not put this token in POS configuration, PWA assets or an installer.
- Without these settings, customer-local sync and monitoring continue normally; no central live report is claimed. The relay runs every 30 seconds with a request deadline and does not overwrite device receipt times when replaying reports.
- Interrupted PWA catalog pages remain staged until the complete catalog can be activated atomically. Rejected queued bills stay on the device for explicit review/retry. Native bills require matching successful acknowledgements and use recoverable outbox claims. Native catalog delta watermarks come from the database before the first page, not the device's completion clock.
- Verification in this workspace covers browser catalog interruption/recovery, rejected-bill retention, acknowledged retries, cross-window lock exclusion, reload persistence, ordered/redacted server reports and stale replay handling. Native Rust/Tauri compilation and signed-installer validation still require the native build pipeline. No installer has been published as part of this implementation.

## References

- [WHM account creation](https://docs.cpanel.net/whm/account-functions/create-a-new-account/)
- [WHM API token management and privilege considerations](https://docs.cpanel.net/whm/development/manage-api-tokens-in-whm/)
- [Node.js installation prerequisites and cPanel runtime considerations](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/)
- [cPanel UAPI Passenger application registration](https://api.docs.cpanel.net/specifications/cpanel.openapi/application-manager/passengerapps-register_application)