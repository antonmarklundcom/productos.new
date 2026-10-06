# Template hardening and store readiness

This release addresses audit R1–R21. Finish template verification before creating Anillos or another store. Supplier contracts, ring merchandising, final brand design, real contact details and commercial promises belong to each store's configuration.

## Upgrade

Run the checked-in migrations (`pnpm db:migrate`) before starting the upgraded application. Migrations 0018–0022 add session versions, account-bound OTP attempts, durable operation keys, notification delivery state, card initiation state and product selling modes. Migration 0018 invalidates outstanding legacy login challenges. Existing admin/customer cookies without a current session version must sign in again.

Set a strong `SESSION_SECRET`; placeholders fail validation. A separate customer secret must be strong and different from the admin secret. With no separate secret, a domain-separated customer key is derived from the admin key. Changing the admin secret also affects encrypted integration settings and recovery, so retain the previous secret securely during a planned rotation.

Use the account/domain functions for password resets, role changes, deactivation and reactivation: they revoke old sessions. The owner CLI also increments the session version when resetting an existing account. First phone verification removes a password set before ownership was proved and prompts the verified person to set a new one.

## Payments and retries

Transfer requires all bank fields. Card requires complete Pagopar configuration. Shipping methods further restrict the usable options. The quote, checkout and server transaction all check readiness; removing a bank account between quote and submission rejects the new purchase without reserving stock.

Each form attempt has a random operation key persisted in session storage. Retrying a committed checkout, refund or return with the same key and payload returns the recorded result. Changing the payload with that key is rejected. A completed form clears its key so a deliberate second operation remains possible. After 30 days the saved result is removed, but its key remains as a tombstone; an old attempt must be reviewed rather than executed again.

Card initiation makes at most one provider POST for an order. A known pending link is reused. A connection failure can mean Pagopar accepted a request without returning its response, so `starting`/`unknown` states cannot initiate another charge automatically. The order detail page calls for provider review. Confirm the real operation in Pagopar, follow its reconciliation/refund procedure, and resolve the existing order before authorizing a new purchase.

## Notices and order-link recovery

Order notices are inserted in `notification_outbox` inside the order transaction. The worker reads committed tracking/details and atomically claims a notice before sending. The expiration cron drains the queue every 15 minutes. A definite provider rejection can retry up to five times. A timeout, lost response or expired sending lease becomes uncertain and requires owner review. Provider acceptance is not proof that a customer read the message; there is no claim of exactly-once external delivery.

The owner sees notice status and can resend after acknowledging a possible duplicate. Verify delivery in the provider before using this control. Do not delete queue rows to force a resend.

Public order number plus phone no longer reveals the private link. Recovery can send it using the distinct approved WhatsApp recovery template (one body parameter containing the complete URL); sending runs after the generic response. Without this integration, only an already verified matching customer account gets a link in the response. Otherwise the customer contacts the store. A phone match alone never permits attaching a guest order to an account: attachment requires its private access token.

## Proxy and rate limits

`TRUSTED_PROXY_HOPS` defaults to one trusted proxy and selects the corresponding address from the right of the forwarded chain. Set it only after verifying the actual host chain and whether the origin can be reached directly. The owner-only `/api/admin/proxy-diagnostic` endpoint returns the configured hop count, chain length and selected address, without logging the raw header.

On the actual host, compare a normal request with one carrying invented forwarded entries; both must identify the same real client. Check the configured Node process count. The memory limiter is per process and resets on restart. OTP attempts and challenge issuance are also guarded by account rows in the database. If the host runs multiple instances or needs durable request limits, configure a shared limiter before relying on IP limits for abuse control. The local audit cannot establish Hostinger's live proxy/process configuration.

## Product and policy settings

`stock` products keep physical inventory, purchase controls, server reservation checks and merchant offers. `enquiry` products allow variant selection even at zero stock and link to the store's configured contact. `showcase` products display without a purchase or enquiry button. Enquiry/showcase variants cannot enter checkout, structured sale offers or merchant feeds through a crafted request.

`showPrice=false` removes prices from public product props and price filters. A displayed enquiry/showcase price is labelled as indicative. CSV import/export and product duplication preserve selling mode and price visibility. Empty contact configuration hides links. New generic policy pages default to disabled; enable and edit only confirmed shipping, returns, privacy and payment policies. Existing explicit page settings remain respected.

## Template distribution and verification

Shared logic, actions, scripts, migrations and translation contracts travel with template updates. Storefront components, account/checkout/product/category pages and admin pages are marked as mixed files: review shared behavior while preserving each store's design. Do not advance a store's baseline without resolving its reported differences.

`bootstrap:repo` prints the complete copy plan and rejects source/destination overlap and destination symlinks/junctions before writing. It also protects the baseline path. `template:probar-tienda` installs from the frozen lockfile in a fresh worktree and runs full validation after the store wizard.

`pnpm test:full` requires an explicitly configured disposable database whose name contains `test`. It runs types, lint, unit/UI/integration tests, prepares fictitious browser fixtures, builds and runs Chromium. It deliberately clears provider configuration in child processes, uses a fictitious owner and resets the test data. Never point it at a store database. Install the matching browser first with `pnpm exec playwright install chromium`. `E2E_PORT` optionally selects an isolated local server port.

Before copying a release, record passing MySQL 8 and MariaDB 10.11 suites, generated-migration consistency, a restore drill, and populated browser checks. Account for the optional real Pagopar sandbox probe separately when credentials are unavailable. Browser checks cover purchase/admin flows, mobile enquiry selection, keyboard use, translation rendering, privacy of recovery, CSP and JavaScript budgets. Real payment/message credentials and hosting diagnostics require a store-specific readiness check.

Public client translations exclude admin/setup copy, and browser account forms import password-policy constants without password hashing. `prebuild` regenerates the client catalog; registered languages must supply the complete message contract. Google Fonts currently requires network access during the build; fonts and brand choices for a copied store are a separate design decision.
