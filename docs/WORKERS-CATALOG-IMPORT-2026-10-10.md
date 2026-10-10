# Native D1 catalog import and R2 gallery uploads

This increment extends the existing enquiry catalog on the Workers branch. It does not enable checkout, payment processing, order transitions, customer accounts, stock reservation jobs or the remaining pending admin sections.

## Catalog import

- `/admin/productos` retains preview-before-confirm and duplicate review. The Workers adapter accepts CSV/Excel files up to 800 KiB and 500 products.
- Confirmation sends sequential batches of five products. Each batch uses a native atomic D1 `batch`, not a simulated interactive MySQL transaction. A SKU belonging to another product aborts the entire batch, including newly inserted categories.
- Existing stock is retained unless the owner explicitly checks stock overwrite. Omitted enquiry/price-visibility/private supplier-link fields are retained. Existing galleries and alternative suppliers are retained; repeated imports do not duplicate SKU rows or the preferred cost offer.
- New gallery references must use the existing `r2:p1/...@WIDTHxHEIGHT` format. All referenced WebP sizes and JPEG fallback must exist in the bound bucket before the batch writes. External source URLs are not downloaded by this import action.
- A disconnected client cannot know whether the last batch committed. It reports that uncertainty and the count of previously confirmed products. Review the catalog and re-preview before retrying; do not assume a timeout means nothing saved.

## Product image uploads

- The browser prepares WebP responsive sizes and JPEG fallback locally, with a maximum long edge of 1200 pixels and an 800 KiB combined payload. No paid image transformation service or server-side native image processing is required.
- The server checks the encoded formats and dimensions independently, writes immutable objects through the existing `IMAGES` binding to `productos-images`, then inserts the gallery row. Staff authorization is rechecked inside every action.
- A storage failure before the gallery insert attempts cleanup only of the new upload's keys. After a database-write attempt, files remain: an acknowledgement failure can conceal a committed row. This can leave orphan objects on a genuine failed insert, but does not break a successfully committed gallery by deleting its images. Later cleanup requires checking references first.
- Removing a gallery entry requires both product ID and image ID; R2 objects are retained to avoid deleting an object referenced elsewhere.
- The existing 1 MiB request ceiling remains unchanged. No existing catalog images were re-uploaded for this increment.

## Verification and release

Run from the existing `C:/Projects/productos-workers-staging` checkout:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:workers-preview
pnpm build:vinext
```

Workers tests use a disposable local D1. They cover concurrent repeat imports, stock preservation/explicit overwrite, cost alternatives, SKU-conflict and photo-insert rollbacks, format validation, failed R2 acknowledgements, and a real D1 insert whose acknowledgement is simulated as lost. Build assertions require the native import/upload implementations in the emitted server bundle and preserve client/server directives and authorization guards.

Release through the existing Git-connected `codex/workers-staging-20261009` branch. Do not change `main` or the build branch as part of this increment. PR14 remains unmerged. The bucket binding adds no bucket or subscription; the Worker already serves live apex/www, so a successful branch build updates the live site.

The owner can eventually retain the Hostinger revision as an archive branch/tag and make Cloudflare the main branch. That needs a deliberate deployment-branch and CI transition after the required feature parity and rollback are accepted. A second repository is unnecessary.

## Usage checkpoint

At 2026-10-10 13:53:47 UTC, Cloudflare adaptive analytics for 1 October onward reported 1,774 site invocations, 80,999.668 CPU ms, no runtime errors and 45.659 ms arithmetic mean CPU/invocation. The site's CPU median was 11.084 ms; its 99th percentile was 414.814 ms. Mixed versions and testing are included. These are not a representative customer-session benchmark.

The CPU allowance alone supports approximately 657,000 invocations at that mean. With five page views/session and two Worker invocations/page, that is about 65,700 sessions. Use 50,000 as a provisional planning budget allowing other account activity. Images/static assets, cache behavior, bots, admin operations and other sites must be tracked separately; the monthly subscription is not a hard spending cap.

Current pricing must be rechecked at https://developers.cloudflare.com/workers/platform/pricing/ before budgeting. Owner usage evidence is under `E:/ai work/Artifacts/productos.new/2026-10-10/usage-and-catalog/USAGE.json`. The runtime usage measurement does not include build usage and does not establish D1/R2/email cost at future traffic volumes.
