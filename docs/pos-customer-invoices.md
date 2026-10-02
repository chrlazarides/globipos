# POS customer invoices and approved credit

## Enablement

Assign **Wholesale Invoice** (`WHOLESALE_INVOICE`) or **Customer Account Sale**
(`CUSTOMER_ACCOUNT`) to the terminal's layout in the layout editor. Neither is
added automatically. Pair the device using its secure device key; the installed
POS can save or replace that key using **Device key** in its header.

Open a customer's profile, then **Credit**, to approve, suspend, or change the
limit and terms. A reason is required and changes are recorded. Administrators
and superusers can approve. A staff/manager account must have the explicit
**Can approve customer credit** permission; empty module permissions alone do
not grant approval. These accounts are the same customer accounts used for
loyalty, not separate credit wallets.

## Cashier flow

Build a basket, choose the assigned action, authenticate with the cashier PIN,
find the customer and review the server quote. Wholesale mode uses the customer's
price level and active contracts. Retail account mode retains the terminal price
level and VAT-inclusive retail prices; it does not apply wholesale contracts.
Invoice lines show net prices and a separate VAT total.

Confirm the quote and pay cash, record an **already-approved external card
payment** with its reference, or use approved account credit. This flow does not
initiate a card-terminal charge. On-account checkout cannot exceed the limit.
Overdue invoices warn but do not block; suspended/unapproved credit does block.
These operations are online only.

After issuance, print the existing invoice format or email the customer's saved
email address. The invoice is available in the existing back-office invoice list,
payments and customer account. Changes to limits/terms for existing customers
must use the Credit tab rather than the general edit form.

## Financial and operational boundaries

Invoice, POS order, payment (when paid), accounting entries and stock consumption
commit together. A durable checkout ID prevents duplicate posting on unchanged
retries; a changed payload reusing that ID is rejected. Cashier, paired device,
terminal assignment, prices and customer credit are checked server-side. Credit
checkouts for one customer serialize to prevent simultaneous overspending.
Cash Back never increases the credit limit or silently settles debt.

Account-credit sales count toward turnover but not cash/card collected.
Installed terminals record their shift totals separately with an idempotent
local receipt and never enqueue a second sale for normal synchronization.
If local shift recording fails after issuance, the POS explicitly reports that
the invoice is already issued and must not be issued again.

Issued linked POS invoices cannot be edited. Settle them through existing
Payments; use a linked invoice credit note for corrections/returns, not the
voucher-return workflow.

## Database and rollout

The development database has the additive migration
`lib/db/migrations/0004_pos_customer_credit.sql`. Apply it (or the corresponding
Drizzle schema push) to each customer installation before running this version.
Existing limits do not automatically become approved; profiles start pending.
No existing customer is automatically granted credit.

Publishing the web applications does not update installed native binaries.
Native changes need a newly built/signed release through the existing GitHub
release process. Test actual native printing and shift recording on the
target devices before rolling the native release out.