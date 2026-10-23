# Catalogue durability and revision checks

23 October 2026. Applies to the native Workers catalogue. These changes are implemented on codex/productos-catalog-completion-20261023 and require the generated additive migrations before release; this document alone does not authorize production application.

## Schema and release order

D1 migration0004_mysterious_captain_midlands.sql adds products.revision, catalog_audit, catalog_import_runs and catalog_import_receipts. Migration0005_spicy_carmella_unuscione.sql adds allowlisted numeric import summary metadata. The retained MySQL path has generated drizzle/0025_typical_frightful_four.sql for revision and audit. D1 remains the active runtime; a MySQL migration is not applied to D1. Migration0003 is historical and was owner-approved/applied for PR17; do not repeat its setup as new work.

Run required typecheck/lint/full tests and both builds; run the disposable built-Worker browser suite. Review exact PR head/CI and authorize the new production D1 migration separately. Apply approved migrations before merging code that reads revision/receipts. After automatic deployment, match the main commit and active Worker version and perform bounded public acceptance. No production migration or new release is implied by local tests.

A code rollback should retain additive schema/data. Do not drop audit, receipt or revision data as an automatic rollback step.

## Imports

The native action binds a random import identity to authenticated actor, SHA256 of file bytes and stock-overwrite option. Atomic batches contain catalogue writes, audit events, a batch receipt and next-offset update. A lost acknowledgement returns the original confirmed receipt. Reusing an identity with a different actor/file/options fails. Concurrent attempts use the checkpoint and unique receipt guard, so the losing request reads the winner's receipt.

The browser stores only identity and digest in sessionStorage, not the file or supplier data. After reload, select the same file/options and review again; confirmed batches replay without repeating their writes. A new import identity is an explicit reset. The current existing policy permits already-committed batches to be published before later batches finish. Whole-file publication staging has not been introduced. No automatic receipt expiry/deletion is enabled until retention is chosen.

The retained normal Next/MySQL import does not have D1 receipts. Its UI does not advertise native resume or persist native identities; ordinary SKU upsert remains its existing behavior.

## Editing and history

Product/variant edits send expectedRevision. Revision guards and writes are transaction-bound (MySQL) or in one atomic D1 batch. A stale save fails without changing variants/product/history and leaves the client draft available for copying/reloading. Related imports, images, supplier and category edits bump affected revisions as documented in their writers. Invalid or foreign variant IDs are rejected before mutation.

History stores actor ID, operation, record type/ID, revision and allowlisted field names. It stores no raw private costs, URLs, integration values, file contents or secrets. Product history is bounded to20 recent events through an authenticated page; owner sees product events and staff sees their own events. No public history route or unrelated legacy activity feature is enabled. Retention is an owner decision; no automatic deletion is active.

## Verification and limits

The native fixture exercises lost acknowledgement, exact receipt replay, actor/input isolation, concurrent stale product/variant saves and unchanged rows/history after rejection. SQL integration tests exercise concurrent editor wins, foreign/missing variant rejection, fresh save and stock-preserving import revision/audit. Browser acceptance uses isolated synthetic local D1/R2 and real application login/forms. No real store checkout, production account, outgoing email or live catalogue write is part of these tests.
