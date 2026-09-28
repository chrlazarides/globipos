# Customer data isolation

GlobiPOS's installation schema contains **no tenant column**. One hostname or
URL per customer against the same database is **not** isolation. The existing
`DATABASE_URL` is the original installation's data; never point a second
customer at it.

The API supports two modes:

- **Legacy (default):** no `TENANT_DATABASES`; one installation, original
  `DATABASE_URL`, existing behavior. Do not enroll another business here.
- **Shared process, isolated databases:** configure the `TENANT_DATABASES`
  secret as a JSON object mapping stable tenant IDs to distinct PostgreSQL
  connection URLs. The *one* original tenant can use the literal
  `"$DATABASE_URL"` to retain existing data. Configure `TENANT_HOSTS` as a JSON
  object mapping exact, canonical hostnames to tenant IDs; every database needs
  at least one hostname. For example, with **nonfunctional example values**:
  `TENANT_DATABASES={"original":"$DATABASE_URL","new":"postgresql://.../new_db"}`
  and `TENANT_HOSTS={"original.example":"original","new.example":"new"}`.
  Store actual URLs as secrets; do not commit them. Never reuse one database
  under two IDs. Apply the installation schema/migrations to each database
  before adding its mapping, and provision its administrator securely.

At startup the API checks that all mapped databases are migrated and resolve to
distinct database identities. It fails to start on unknown/missing tenant host
configuration or when shared payment/WhatsApp provider credentials are present
(those integrations are not yet tenant-specific). Customer requests are bound
to a tenant via the raw, allowlisted
Host header (not `X-Tenant`, forwarded host, a path, or an arbitrary JWT field).
Unknown hosts are denied, including public, export, and native terminal routes;
only the infrastructure health check is host-independent. A session's tenant
claim must match the selected host; session and 2FA tokens from before
multi-tenant mode are rejected. Customer portal tokens also carry a tenant.
Each request, transaction, direct-ID lookup, export, restore, and POS terminal
sync uses a database connection dedicated to that tenant. DB access without
context fails in shared-process mode. Roles and permissions are evaluated
*after* tenant binding, against that tenant's signed session.

Scheduled backups, invoice sweeps, overdue-payment reminders and WhatsApp cart
persistence iterate tenants with distinct contexts. The central deployment
domain monitor is disabled in shared-process mode because it belongs to a
separate operator control plane, not a customer installation. Product
image uploads use tenant-prefixed keys in shared-process mode. Only the tenant
explicitly mapped to `"$DATABASE_URL"` may read and remove its older unprefixed
image keys during the transition; all new customers are restricted to their
prefixed keys. The application does not
auto-seed demo data or a default administrator into any new tenant database.
Packaged deployment downloads are unavailable in shared-process mode because
their legacy builder dumps the process-wide original database URL, regardless
of the requesting tenant. Use tenant-specific database backup procedures until
the package builder itself is tenant-scoped.
The offline Terminal clears cached customer data when its registered server,
terminal code, terminal ID, or location changes; it blocks a switch while
offline sales remain queued so those sales cannot be uploaded to another
customer's installation.

Each tenant database must be migrated separately on upgrades and have its own
backup/restore plan. The preferred production topology is still a separate
deployment and database per customer. **Do not enable shared-process mode
before provisioning, migration, domain setup, and a cross-tenant acceptance
test have been completed for every customer.** Separate tenant databases do
not make an untrusted host-header alias, a copied database containing another
customer's data, or a shared external payment/WhatsApp credential safe.