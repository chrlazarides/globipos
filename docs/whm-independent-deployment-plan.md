# GlobiPOS independent WHM deployments

Status: proposed architecture and implementation plan. Full WHM administrator/root access confirmed by the owner; server capabilities and SSH/API access remain to be verified.

## Goal

Run independent customer installations on WHM-managed hosting. Extend the existing Deployment menu into a central control centre for provisioning, API connections, release management, health monitoring and technical support. The owner's superuser support identity must be available in every installation.

Each customer installation must continue normal operation if the control centre is unavailable. An unavailable or stale monitoring connection must never be mistaken for a healthy installation.

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

## 7. Ordered implementation

1. **Capability audit and specification:** use the confirmed full administrator access to verify SSH/API permissions and pilot server capabilities; choose the supported runtime/provisioning method and recovery requirements. The audit is read-only.
2. **Independent installation baseline:** create one isolated pilot customer account, package adapter, database migration process, secrets and verified backup/restore procedure.
3. **WHM/cPanel connections:** add the WHM provider, secure connection registry, capability checks and permitted provisioning operations.
4. **Management agent and monitoring:** add authenticated enrolment, reporting, external checks, operation jobs and agent lifecycle handling.
5. **Support access:** add managed support identity, MFA-protected session launch, revocation, audit and emergency recovery.
6. **Release execution and dashboard:** wire rollout records to real execution; expose versions, health, support details, diagnostic exports and controlled update/rollback actions.
7. **Pilot and staged rollout:** verify one non-trading/pilot installation, then one approved customer installation before expanding deployment groups.

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

## References

- [WHM account creation](https://docs.cpanel.net/whm/account-functions/create-a-new-account/)
- [WHM API token management and privilege considerations](https://docs.cpanel.net/whm/development/manage-api-tokens-in-whm/)
- [Node.js installation prerequisites and cPanel runtime considerations](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/)
- [cPanel UAPI Passenger application registration](https://api.docs.cpanel.net/specifications/cpanel.openapi/application-manager/passengerapps-register_application)