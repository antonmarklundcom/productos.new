# Recover and resume a catalog import

## Keep the normal workflow simple

Use the local photo pipeline with private bucket credentials to upload images. Use the authenticated store admin to preview and import the catalog. A separate Hostinger login is only needed when provider logs, deployment settings or database inspection are necessary to resolve a failure.

Hostinger environment variables are not automatically available to the local uploader. Keep local R2 credentials outside Git with restricted access. Public image delivery reads the exact build-time key `NEXT_PUBLIC_IMAGENES_URL`; changing it requires a rebuild. Never use a `NEXT_PUBLIC_*` key for a secret.

## Diagnose before retrying

1. Save the visible error, time, intended batch IDs and preview counts. A successful preview does not prove a write succeeded or that all required product columns exist.
2. Preview the same batch again after recovery. New versus existing product counts reveal partial progress. Check existing galleries as well: product upserts and photo registration happen in separate stages.
3. On an HTTP 429 or unexpected response, stop write attempts and back off. Inspect provider logs and retry guidance. Avoid repeatedly refreshing or sending simultaneous admin import requests.
4. On a returned generic action error, inspect the first server log entry for `applyCatalogImport falló`. Catalog export uses additional product fields and can help confirm the affected read path, but its generic error does not by itself identify a missing column.
5. If logs indicate an unknown column, inspect the current database schema and migration ledger read-only. Required product import columns include `sale_mode`, `show_price` and `dropi_url`; their versioned migrations are in `drizzle/`. Use the current repository's documented migration procedure and backup/recovery preparation. Do not use an unreviewed `db:push`, rerun the sample seed or recreate the owner account.
6. The existing `/api/setup/init` route can run versioned migrations with an empty body and the privately managed `SETUP_SECRET`, as documented in [DEPLOY.md](../../DEPLOY.md). It is not a public repair endpoint. Verify the live deployment, migration state and authorized operation before using it. Never put the secret in a URL, screenshot, report or chat.

Do not create a second importer, disable authentication or expose database credentials to work around a server error.

## Resume safely

1. Preserve the reviewed CSV and immutable manifest. Match by Dropi ID and stable SKU/slug; do not merge products merely because they share a generic phrase.
2. Confirm every delivery object is uploaded. Use the existing uploader's recorded proofs to resume; do not overwrite immutable conflicts blindly. Originals and private manifests remain local.
3. Import one reviewed product first. Verify the saved retail value and price visibility, the actual category, all gallery entries and the private supplier link. Confirm the public page renders correctly on a phone-sized viewport.
4. Continue with one five-product batch at a time. Preview every batch, check the expected counts, then confirm it. Keep stock overwrite off unless a separately reviewed inventory update requires it.
5. Record successful IDs and counts after each batch. If the response is unclear, read the store state before retrying. A missing success message is not proof that no data was written.
6. Check the final catalog export/count, public product URLs, gallery delivery, canonical metadata and offer/price visibility. Do not claim checkout is ready from an enquiry-mode import.

## Prevent recurrence

- Configure one supported CDN layer for the storefront. Keep the R2 image hostname independent. [Hostinger's guidance](https://www.hostinger.com/support/hostinger-cdn-vs-cloudflare/) warns against placing Cloudflare in front of Hostinger CDN. Verify the Node app's actual origin before changing a target.
- Run the deployed application's versioned migrations through the established procedure after schema releases. An environment-variable rebuild does not automatically migrate the database.
- Pilot writes as well as previews before starting a large rollout.
- Distinguish supplier snapshot stock from store inventory, proposed retail from tested retail, gross margin from net profit, and uploaded images from published products.
- Keep product register status current. Planned store links must remain marked pending until verified live.
