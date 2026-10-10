# Native D1 settings repair — 10 October 2026

This follow-up continues the Cloudflare catalog/admin port. The live database health check already passed with 262 products, 821 gallery images, nine categories, 262 variants, 262 supplier offers, one owner and zero orders. The repair addresses unsupported MySQL settings transactions; it does not repeat the earlier Hostinger schema repair.

## Implementation

- Build verification checks the emitted server JavaScript for the native settings writer. Vite needs an explicit settings alias as well as the relative-import resolver; direct native tests alone do not prove the bundled action uses it.
- Workers resolves the settings domain to a native D1 implementation. Hostinger's original MySQL implementation remains intact.
- A single SQLite UPSERT replaces one validated section, or only the supplied policy pages, using JSON functions. Concurrent saves to separate sections/pages preserve each other's changes. Explicit nulls remain defaults; malformed legacy JSON recovers safely. Updated timestamps use UTC and the acting owner's ID is recorded.
- Existing owner-only settings actions remain guarded. Upload actions remain unavailable; no image re-upload, new transformation service or payment is required. Client accounts cannot be activated through this port.
- `/admin/ajustes` is enabled in the protected route policy and menu. Public contact, branding, announcement, policy and presentation controls can save without a MySQL transaction.
- The Workers overview reads actual catalog counts in one query. It no longer shows misleading free-shipping, payment or Hostinger-cron warnings for an enquiry-only store.

## Verification and operating procedure

Use `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:workers-preview`, and `pnpm build:vinext` in the existing checkout. Workers tests include `scripts/verify-workers-settings.mts`, which creates an in-memory disposable local D1 with a fake database ID and never writes to remote D1. It exercises inserts, concurrent section/page saves, explicit nulls, validation, malformed JSON recovery and forced failure with unchanged data.

The owner can open `/admin/ajustes`, save one section and reload to verify persisted values. Each section has its existing restore-default control. Restoring defaults is a deliberate business change, not part of deployment verification. Existing R2 gallery images, catalog prices, supplier alternatives, stock and accounts are retained.

Git deployment watches `codex/workers-staging-20261009` in the existing `productos-workers-staging` Worker. Do not merge this migration branch into Hostinger main solely to deploy it. No new schema migration is necessary. Build/deployment revision, native local results, authenticated acceptance and before/after catalog hashes are recorded in the dated external report.

## Remaining compatibility work

This is still an enquiry catalog, not a complete transactional storefront. Checkout/orders/payments/reservations, stock-changing operations, import confirmation, new uploads, account/user management, encrypted integration editing, audit screens and jobs need separate native D1 implementations and tests. Password recovery delivery still needs its configured sender and inbox acceptance. Do not remove the existing implementation-boundary action guards to enable these features.

Production data lives in D1; images remain in the existing R2 bucket. D1 and the retained Hostinger database are separate and not synchronised. Keep Hostinger recovery available until the desired workflows and data recovery are accepted. No new paid service was enabled by this repair.

Evidence: `E:/ai work/Artifacts/productos.new/2026-10-10/d1-settings-repair/REPORT.md`. Owner manual: `C:/operation manuals/productos.new/README.md`.
