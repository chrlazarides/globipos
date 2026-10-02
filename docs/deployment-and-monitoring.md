# GlobiPOS Deployment and Monitoring Manual

Revision: 2026-10-02 (Europe/Nicosia)

For deployment operators, superusers and POS administrators. This guide describes the existing release paths; it does not publish an app, install an agent or change a database. Record operational times in Europe/Nicosia and keep the original UTC timestamp from logs when escalating an incident.

## 1. Choose the correct deployment procedure

Replit Publish/Republish updates the web Back Office, PWA and application server in this project. It does not build or publish the installed Tauri POS executable.

GitHub Actions builds and publishes signed native POS installers. Existing supported desktop installations discover a higher version through the Tauri updater.

An independent customer server needs its own application deployment, PostgreSQL database, configuration, HTTPS and process supervision. Publishing the master does not automatically update an independent customer installation.

Run fleet management from a dedicated published master. Customer installations must remain able to trade when the master is unavailable. Never copy master fleet credentials into a customer installation.

- Identify the target: web/PWA server, installed native POS, dedicated master, or independent customer server.

- Record the current and intended Back Office and POS versions separately.

- Identify who may approve publishing, database changes, native release tags and customer cutover.

## 2. Pre-deployment safety checklist

1. Arrange a maintenance window and nominate the operator who will decide whether to continue or stop.

2. Check outstanding POS bills, failed acknowledgements and offline queues. Do not clear browser storage, reinstall a terminal or delete queued records to make the status look clean.

3. Create a fresh recoverable backup. For moving a complete server, use the superuser System Export or a verified PostgreSQL dump as appropriate; a normal JSON backup is not a full account/configuration migration.

4. Store backups outside the server being changed with restricted access. A SQL dump or System Export can contain confidential business data, user security material and sensitive settings.

5. Record release identifiers, database schema state, current domains, process configuration and the previous working release. Keep secret values in the approved secret store, not in the deployment record.

6. Build and run the focused checks for the change. Investigate failing checks; do not treat a successful frontend build as proof that native Rust code compiles.

7. Review any proposed database migration, especially dropped tables/columns, type changes and data replacements. Test restore and migration on a disposable environment first.

> Important: Never import a deployment dump, use Restore (Replace All), run a blind schema push, or rerun a fresh-install setup script against a trading database as a normal software update.

## 3. Publish or republish the Replit web application

1. Complete the pre-deployment checklist and confirm the intended code is present in the workspace.

2. Open the Publishing tool. Review the deployment target and application build/run settings. For this monorepo, artifact production settings determine each service's build and run commands; do not substitute development commands.

3. Confirm the production environment has its required database connection, session/authentication settings and enabled provider configuration. Configure credentials through Secrets/integrations; never paste them into chat or source control.

4. Review the production database schema changes shown during publishing. Stop if an unexpected destructive change is proposed. Republish is not permission to overwrite customer data.

5. Click Publish or Republish. Follow the current attempt in Publishing logs until the build and launch finish successfully. Do not assume that a responding URL means the new build has finished; an older build may still be serving.

6. Open the published URL shown in Publishing, not a workspace preview URL. Check HTTPS and the health endpoint, then sign in and verify the intended version in the application.

7. On an authorised test terminal/account, check a small approved workflow and reconcile its result. Do not create an unapproved live sale merely to test deployment.

8. Keep Publishing logs and Monitoring open during the observation window. Record the successful release, time and outcome.

Public health check: replace the hostname with the actual published domain

```sh
curl -fsS https://YOUR-PUBLISHED-DOMAIN/api/healthz
```

> Important: Expected health response: {"status":"ok"}. This proves the server is responding, not that database queries, email delivery, backups or terminal sync all work. A private/password-protected deployment can block unauthenticated checks; do not disable access protection to make a monitor pass.

## 4. Confirm the PWA received the web update

1. Confirm that publishing has completed and that the production web application shows the expected version.

2. Bring the PWA online and allow pending bills/audits to finish uploading. Confirm acceptance in the Back Office, not just a network-connected icon.

3. At a safe break in trading, use the application's update/reload action if offered, or close and reopen the PWA while online. If the old shell remains, stop and investigate its cached asset version.

4. Open POS Sync Monitor and check the device's current catalog transfer, pending/failed bills, audits and channel-specific last-success times.

5. Interrupting a catalog download must leave the previously active complete catalog usable. The downloaded catalog becomes active only after the entire transfer completes.

> Important: A closed or sleeping PWA cannot continuously report. Do not uninstall it, clear site data or reset IndexedDB while it contains unsent transactions.

## 5. Prepare an independent customer installation

1. On the published master, sign in as a superuser and open Deployment Control. Create or review the customer profile: stable slug/identity, customer name, customer domain, Back Office/POS URLs, optional eShop domain, features, providers and target versions.

2. Confirm the intended hosting server and customer account before provisioning. Changing a hosting preference is not an automatic migration of an existing customer.

3. Arrange a supported Node.js runtime, PostgreSQL, private configuration storage, process supervision and HTTPS on the chosen server. Confirm the hosting account actually supports these features before purchasing or provisioning it.

4. Create a dedicated customer database and database user with only the required privileges. Keep the database inaccessible from the public internet unless a reviewed access policy explicitly requires it.

5. Choose a verified application release/package. Inspect its manifest and included README before installation. The legacy source ZIP expects package.json, client/, server/, shared/ and related source folders; a compiled ZIP expects dist/. Neither is automatically interchangeable with this pnpm monorepo.

6. If a package download reports missing source/build files, stop. Do not manufacture empty folders, use an unverified ZIP, or clone an unrelated repository to bypass that check.

7. Set the customer's environment and providers through the approved configuration template. Keep master credentials out of customer configuration and keep production secrets out of the webroot.

8. Configure the customer domains and HTTPS, then deploy the application using the package-specific instructions below.

> Important: Saving a profile, selecting an automation provider, requesting an upgrade or entering a target version is not proof that an application has been installed or upgraded. Confirm the actual server/agent outcome.

## 6. Install a verified customer package on a new server

1. As a superuser, open Settings → Backup & Recovery and choose the appropriate deployment package. Confirm the download completes successfully; store it privately.

2. Extract the package into a private application directory outside the public document root. Confirm the SQL dump, environment template, process config and relevant source/build files are present and match the approved release.

3. Create a NEW, empty customer database. Validate that DATABASE_URL points to that database before any import. Do not print its value or place it in a shell command history.

4. Import the reviewed dump with PostgreSQL's error-stop option. Any SQL error is a failed validation step; do not assume role/ownership errors are harmless.

5. For the legacy source package, install build dependencies and build using that package's package.json/README. The generated setup.sh also imports database.sql: use it only for an approved new installation and inspect it first, not for routine updates.

6. For a compiled package, retain its verified dist/ and follow its included start.sh/PM2 instructions. Do not run source-only build commands against a compiled-only package.

7. If deploying this workspace's source instead of a legacy package, use pnpm and the artifact build/start commands. Do not copy old npm run db:push instructions into a live monorepo deployment.

8. Start the application with its approved process supervisor and correct private environment. Configure the reverse proxy to route both the web application and /api to the correct services. Never expose .env, database.sql, exports, internal admin credentials or the PostgreSQL port publicly.

9. Verify HTTPS, /api/healthz, login, customer branding and the expected release. Check database-backed screens and a controlled POS sync before admitting normal traffic.

10. Remove installation dumps/archives from any web-accessible location, retain protected off-server copies, and record installation acceptance.

New empty database only, after DATABASE_URL has been privately configured

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database.sql
```

Verified legacy source package only

```sh
npm ci --include=dev
npm run build
```

This pnpm workspace's source: build paths shown for Back Office at / and PWA at /terminal/

```sh
pnpm install --frozen-lockfile
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/globipos run build
PORT=3001 BASE_PATH=/terminal/ pnpm --filter @workspace/globipos-terminal run build
pnpm --filter @workspace/api-server run build
# Configure the supervisor's private environment, NODE_ENV=production and API PORT first.
pnpm --filter @workspace/api-server run start
```

A package that includes ecosystem.config.js and an approved PM2 runtime

```sh
pm2 start ecosystem.config.js
pm2 save
pm2 status
```

> Important: Confirm the packaged release's runtime layout, port and proxy configuration rather than guessing a generic server/dist path. A database import is a data operation, not a software update.

## 7. Connect customer monitoring to the master

1. Confirm both customer and master HTTPS endpoints work and that the customer application is already running independently.

2. Use the customer-specific enrollment/agent configuration supported by Deployment Control and the installed agent. Transfer one-time enrollment credentials only through a secure channel.

3. Install/configure the agent separately on the customer host when required. Profile creation or an enrollment credential alone does not start a host agent.

4. Confirm a real heartbeat reaches the correct customer profile. Compare the reporting installation identity, active release, URLs and timestamp with the server being enrolled.

5. Check the customer and POS domains, and the separate eShop domain if configured. A valid DNS result is not proof that checkout, database access or POS sync are healthy.

6. Verify the customer continues to operate during an authorised, controlled master-connectivity interruption; restore communication and confirm reports recover without losing pending work.

> Important: Do not label an unconfigured or unreachable agent as healthy. Never reuse a customer's identity/agent credential for a different installation.

## 8. Upgrade or migrate a trading customer safely

1. Select one pilot customer first. Record its actual active versions and current database state, then take and verify a fresh backup.

2. Stage the approved application release beside the current one. Compare its environment/runtime requirements and explicitly review required versioned migrations.

3. Apply only approved, tested migrations. Do not overwrite the live database with database.sql or rerun setup.sh as an upgrade.

4. For a hosting move, arrange a cutover window, stop/fence writes on the old installation and account for pending terminal/offline transactions. Preserve the customer's stable deployment identity.

5. Activate the new release or move traffic to the new host. Check HTTPS, readiness, login, database-backed operations, POS sync and the agent heartbeat before declaring success.

6. Confirm the reported active version changed to the expected version. A requested target version or queued rollout is not completion.

7. Observe the pilot, then expand deliberately to more customers. Do not use Upgrade all deployments before the pilot passes and operators approve the wider rollout.

> Important: After new financial or stock transactions reach the new database, switching traffic back to an older database can lose or duplicate data. Stop writes and reconcile post-cutover transactions before deciding on rollback.

## 9. Publish the installed Tauri POS through GitHub

This is a separate, explicitly approved release procedure. Run the release script only when you intend to push commits and create a public signed native release. Replit republishing does not perform these steps.

Updater verification keys and existing signing identities must remain consistent. Configure signing credentials through GitHub Actions repository secrets, not the source tree or release notes.

1. Review and commit all intended native/source changes before release. Check git status and git ls-files to make sure pos-app source changes are tracked; ignored or uncommitted fixes will not reach GitHub. Never force-add a whole folder containing private keys or build output.

2. Check the latest final GitHub release and choose a strictly higher unused semantic version. Align package, Cargo, Tauri and lockfile versions with the existing version helper; never silently replace a published tag.

3. Confirm the repository's required Tauri signing secret and Android signing configuration are present through GitHub's secret settings. Do not reveal their values or rotate the updater public key as a quick fix.

4. Use bash scripts/publish-release.sh with the approved next version. Read its confirmation: it updates version files, pushes the version commit, requests the Windows preflight and pushes a v* tag only after that check passes. It requires the configured project-scoped GitHub credential.

5. If using the GitHub Actions screen for an additional preflight, select Build & Release POS Terminal → Run workflow, select the intended source branch and set preflight_only to true. This compiles Linux and Windows without publishing installers. Check that the run's source commit is the intended commit.

6. Follow the tagged Build & Release POS Terminal run. Require the release-version safeguards, Linux and Windows native preflights, platform installer builds and published-asset verification to succeed. A frontend-only check is insufficient.

7. Open the final GitHub release and inspect installers, desktop .sig files and latest.json. Confirm that latest.json reports the release version and contains the supported desktop platforms and signatures.

8. Run the existing release verifier where repository access is available. Its metadata/signature-presence checks do not replace an actual Tauri install/signature-verification test.

9. Update one pilot terminal, verify the running version and successful catalog/bill/audit sync, then expand the rollout.

Read-only source/version checks from the repository root

```sh
git status --short
git ls-files pos-app/src pos-app/src-tauri/src
node scripts/pos-version.mjs --check
```

Publishes a native release: 1.0.13 is an example, replace it with the approved higher unused version

```sh
bash scripts/publish-release.sh 1.0.13
```

Check the published release's expected assets (metadata only, not packaged logo verification); use the existing authenticated environment if required

```sh
node scripts/verify-pos-release.mjs chrlazarides/globipos latest --metadata-only
```

The native release workflow also extracts the actual packages and verifies GlobiPOS artwork. It saves `branding-*` inspection reports and compares their binary checksums with the downloaded release assets. For the full check, download all four reports from the same successful GitHub build into `branding-reports/`, then run:

```sh
node scripts/verify-pos-release.mjs chrlazarides/globipos latest --branding-reports branding-reports
```

> Important: If a signing/build/verification job fails, do not advertise the release as ready. Some assets may already have been uploaded. Inspect the failed job and the release state; do not bypass the gate or retag a different commit.

## 10. Install and verify a terminal update

1. Bring the desktop terminal online and check that outstanding transactions are preserved. Use a safe pause in trading for installation.

2. The Tauri updater checks about 15 seconds after launch, then hourly. It offers a higher available version; it does not force immediate installation.

3. Accept the in-app update when offered, keep the device online and powered, and allow the download/install to finish. Follow the installer's restart instructions.

4. Reopen the terminal and verify the running version, customer server URL and terminal registration. Check peripheral operation and the channel-specific sync results.

5. If no update appears, compare the installed version with latest.json, check connectivity and review updater errors. A device already on the manifest version will not receive a same-version update.

6. For first installation use the approved platform installer and register the terminal against the correct customer server. Windows setup .exe files are installers, not portable executables.

7. Treat Android separately: use the compatible signed APK and Android's installation procedure. The desktop Tauri updater is not evidence of Android automatic updates. Preserve the Android signing identity and test an in-place upgrade on a pilot device.

> Important: Do not uninstall, reset local storage or re-register a terminal just to resolve an update prompt while unsent transactions remain.

## 11. Monitor four separate layers

A green indicator at one layer does not prove the other layers are healthy. Compare expected and observed versions separately for Back Office and POS.

Keep a deployment record containing operator, customer/host, release identifiers, database migration/backup references, UTC log timestamp, Europe/Nicosia local time and test outcomes. Do not record passwords, tokens or signed download URLs.

- Publishing: Is the intended build actually deployed successfully, or is the URL serving an older successful build?

- Server: Does HTTPS and /api/healthz respond, and do database-backed workflows work?

- Customer control: Are the customer agent heartbeat, actual active version, domains and operator alerts current?

- Device sync: Is each POS/PWA reporting recently, and have catalog, bills and audits actually completed and been acknowledged?

## 12. Monitor the published web application and customer host

1. In Replit Publishing → Logs, check the current build/start attempt first. For runtime problems, inspect application logs around the exact incident time.

2. In Publishing → Monitoring, inspect the available availability, resource and request/error information. Look for recurring crashes or increased latency, not only one successful page request.

3. For a supervised customer host, inspect its actual process manager and application logs. With PM2, use status and describe to identify the configured process name before using logs or restart commands.

4. Check disk space, database connectivity, TLS certificate validity/renewal and backup storage independently. Configure an authorised external monitor if continuous alerting is required.

5. Investigate repeated idle-connection errors or repeated backup retries even if the application recovers. Recovery logging is not proof that the underlying hosting/database interruption has stopped.

PM2 customer hosts only; replace APP_NAME with the name shown by pm2 status

```sh
pm2 status
pm2 describe APP_NAME
pm2 logs APP_NAME --lines 100
curl -fsS https://YOUR-CUSTOMER-DOMAIN/api/healthz
df -h
```

> Important: Do not publish raw logs containing credentials, private backup contents or customer details. A workspace workflow restart is not a restart of the published production instance.

## 13. Monitor Deployment Control and operator alerts

1. On the dedicated master, open Deployment Control as a superuser and refresh the fleet overview.

2. For each customer, compare health status/message, last heartbeat, actual and target Back Office/POS versions, and customer/POS/eShop domain checks.

3. Inspect the customer's history when a version, domain or health state changes. An unknown/offline report may reflect agent connectivity; verify the actual customer application before concluding trading is down.

4. Open Customer POS sync reports and distinguish absent/stale reports from reported sync failures. A reporting path to the master is separate from local customer trading.

5. Review Operator alerts could not be delivered and the resolved history. Record the operation, failure reason, occurrences and last attempt without copying private payloads.

6. Correct the notification provider/configuration first, then let an authorised superuser retry when the cooldown permits. A delivered notification is not proof that the original operational incident is resolved.

7. After recovery, confirm a fresh heartbeat/domain check and the correct actual version rather than manually marking an old report healthy.

## 14. Use POS Sync Monitor without misreading progress

1. As an authorised POS administrator, open POS Sync Monitor for the customer installation (/pos/sync-monitor). Identify the correct terminal and location.

2. Check the device's last report. A device is considered current for about 45 seconds after its last report; sleeping/closed devices become stale/offline rather than remaining apparently live.

3. For catalog downloads, inspect actual records/pages downloaded versus the reported total. An incomplete staged transfer is not an activated catalog and an unavailable total must not be treated as 100%.

4. For bills and audits, inspect pending, in-progress, accepted and failed work with each channel's last successful sync time. HTTP 200 alone is not acceptance: validate the server acknowledgement.

5. Inspect a failed record's reason, correct the cause, then use the supported explicit retry action. Verify the record is accepted and the queue/Back Office result reflects that acknowledgement.

6. If the last channel-success time is old while the device reports normally, investigate that channel. New heartbeats must not reset failed work or overwrite the last confirmed success.

7. During authorised offline/recovery testing, verify unsent work survives reopening the app and is acknowledged once when connectivity returns.

> Important: Catalog records transferred are not units of physical stock moved. A connected device is not the same as a fully synced device. Do not clear failed work or invent a progress percentage.

## 15. Configure, verify and monitor backups

1. Open Settings → Backup & Recovery. Confirm the backup email destination and email provider settings, and enable automatic backup only after a controlled send test succeeds.

2. Send an approved test backup and verify the recipient actually receives an intact attachment. Inspect its backupType, sinceDate, exportedAt and tableCounts, and retain the required previous full/differential files.

3. The application scheduler first checks about one minute after server start, then hourly while the process is running. It attempts a backup when automatic backup is enabled, a destination exists, and the last successful recorded backup is at least 24 hours old.

4. Treat this as an in-process scheduler, not a guaranteed fixed-time external backup service. Shutdowns and scaling can interrupt scheduling. Multiple instances or a failed post-send timestamp write can still produce duplicate emails; an external/durable backup plan is required where that reliability is essential.

5. If a last backup exists less than eight days ago, the scheduled export is differential; otherwise it is full. This is not a guarantee of a weekly full backup when differential sends happen every day.

6. The scheduled runner retries recognised database interruptions up to three attempts with waits of two and ten seconds. It regenerates the export before email delivery; retries of the timestamp write do not resend that email within the same run.

7. Use logs to distinguish Scheduled backup completed, database interrupted; retrying, Scheduled backup failed, Scheduled backup error, and email sent but last backup date could not be saved.

8. After an error, check the last recorded successful backup and actual delivery. If delivery happened but the timestamp could not be saved, confirm the attachment first; do not blindly click Send again.

9. Periodically create a fresh full PostgreSQL backup and test recovery in an isolated environment. JSON differential exports select new transactions by creation date and are not a complete history of later edits/deletions or every subsystem.

> Important: Do not report a successful backup based only on an email-provider acceptance or a green server indicator. Test recoverability. Never restore a backup onto live trading data merely to test it.

## 16. Incident response and rollback

1. Record the affected customer/terminal, current release, exact symptom, local Europe/Nicosia time and original UTC log timestamp. Preserve pending work and stop destructive operations.

2. Check the appropriate layer: Publishing build/start logs, customer process/database, agent/domain report, or device sync/acknowledgement. Identify the first causal error rather than treating every follow-on error separately.

3. For a failed publish, confirm whether the previous build still serves traffic. Correct the evidenced build/configuration issue and republish; do not claim an old working URL proves the new release succeeded.

4. For database disconnects, allow bounded recovery, then investigate the database/host if errors recur. Do not replace the database or run restore/schema changes to treat a connection error.

5. For native failures, pause rollout. Inspect the GitHub job, actual release assets and terminal updater error. A successful web republish does not fix a failed native build.

6. Before any rollback, determine whether new writes or incompatible migrations occurred. Stop/fence affected writers and agree how to preserve or reconcile post-deployment financial and stock records.

7. For Replit code recovery, select the appropriate checkpoint through the workspace recovery tools, understand any database rollback selection, and explicitly republish the approved code. A workspace checkpoint selection alone does not publish it.

8. For an independent customer, activate a tested compatible prior application release only after confirming schema/data compatibility. Do not point traffic at a stale database that has missed recent sales.

9. Verify service and transaction recovery, collect evidence and record the final outcome. Keep the incident open if delivery, active version or transaction acceptance remains uncertain.

## 17. Operator handover and routine checklist

- Immediately after deployment: successful current build, correct active release, HTTPS/health, sign-in, approved database workflow, pilot terminal/PWA sync, agent/domain report and no new unexplained errors.

- During the observation window: refresh server/fleet/device reports and review failed/pending work and notification-delivery failures.

- At daily opening and closing: identify stale/offline terminals, reconcile outstanding bills/audits, review last backup and attachment delivery, and record unresolved incidents.

- At the agreed recovery-test interval: perform an isolated restore test, verify TLS/host resources and review access to backups and signing credentials.

- Handover: record owner, next action and expected follow-up time for each unresolved issue. Do not mark a deployment complete when a required release, backup or transaction acceptance is unverified.

## 18. Reference screens and current documentation

In-app: User Manual (/api/manual), Deployment & Monitoring Guide (/deploy-guide), Settings → Backup & Recovery, superuser Deployment Control (/deployment-control), and authorised POS Sync Monitor (/pos/sync-monitor). Access depends on installation mode and user permissions.

GitHub repository: https://github.com/chrlazarides/globipos — Actions and Releases show the current native build and published version. Do not assume the example version in this manual is the latest.

Replit publishing: https://docs.replit.com/features/publishing/overview

Replit monitoring: https://docs.replit.com/features/publishing/monitoring-a-deployment

Replit production databases: https://docs.replit.com/features/data-and-storage/development-and-production

Replit checkpoints: https://docs.replit.com/features/version-control/checkpoints-and-rollbacks
