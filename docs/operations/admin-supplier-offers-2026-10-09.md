# Private supplier offers and catalog review — 2026-10-09

Implementation branch: `codex/admin-catalog-overview-20261009`, based on main `4b687549cfc385f67d52bc5270f153a8ccf617f6`. Production activation and verification are separate from code checks.

## One public product, multiple private offers

Each store variant can have several supplier offers. The private admin records the supplier/source name, source type (Dropi, local/CDE, imported, other), product URL, supplier/profile URL, whole-guaraní unit cost, captured supplier stock, capture date in UTC, notes, equivalence confirmation, activity and preferred status. Supplier stock is a snapshot, never the store's inventory.

The variant's preferred, active, confirmed offer supplies the cost used in admin margin filters and exports. Selecting a preferred supplier clears the other preferences within the same transaction after locking the variant. An unconfirmed or inactive offer cannot become preferred. Alternatives remain available for comparison. No supplier fields were added to public storefront queries.

Per-offer cards compare hypothetical gross margin at the current retail price. Pending offers are explicitly marked pending comparison. A product's minimum margin is reported only when every variant has a known preferred cost and a positive retail price. Unknown costs are not zero. Multiple offers do not multiply stock, variant counts or gallery counts.

Gross margin = `(retail − cost) / retail`. Markup = `(retail − cost) / cost`. A 100% markup is a 50% gross margin. These exclude shipping, advertising, fees, taxes, duties and returns, and do not reconstruct historical order profit. For imports, record a landed-cost estimate and its assumptions before treating the comparison as attainable margin.

## Admin workflow

1. Open `/admin/productos`. Search name, slug, internal ID, SKU or private Dropi URL. Sort name, category, retail price, preferred supplier cost, minimum margin, stock or recent edits. Filter category, publication, selling mode, price range, cost coverage, featured products, or gross margin at least 50%. Sorting/filtering occurs before pagination.
2. Open a product and its private supplier section. Add an offer without creating another public product. Save unknown cost/stock/date as blank. Enter product and supplier-profile URLs separately.
3. Compare model, dimensions, materials, included accessories and bundle quantity with this exact variant. Confirm equivalence only when established. Set one confirmed active offer with a cost as preferred. Keep unverified alternatives pending.
4. Mark obsolete offers inactive instead of deleting their information. Changing a supplier never changes retail price, publication, own stock, reservations or orders.
5. Owner CSV export includes preferred cost/source, gross margin and markup. Cost/source CSV columns are optional; blank costs leave existing costs alone. A new CSV supplier offer starts pending, with unknown capture date. A different source does not displace the preferred supplier. Ambiguous multiple offers sharing a source name require editing the specific offer in admin.

## Duplicate import review

Admin preview flags shared Dropi IDs, shared image references, or similar two-token names within the same category. Singular/plural and accents are normalized. These signals are not proof of identical products. Review model, size and bundle before deciding whether to create a store product or add a supplier offer to an existing variant.

Confirming a preview with warnings requires explicit review of the current warning list. The server recomputes warnings before writing and rejects a changed/unacknowledged list. This protection is currently for admin imports; the separate CLI importer must not be assumed to have the same review UI. Similar products with different photographs or vocabulary can still escape these checks.

The local 262-product photo/name audit found 12 candidate pairs, not 12 proven duplicates. The sharpeners 13535 / 9710 / 15839 should be reviewed as one product with alternatives. Captured costs are respectively ₲23,000 / ₲31,000 / ₲18,000. These were captured on 2026-10-08, not freshly reverified today. No live deduplication has been performed in this implementation phase.

## Additive migration and recovery

Migration `drizzle/0024_early_hairball.sql` creates only `supplier_offers`, its variant foreign key and lookup index. It does not modify orders, inventory or the existing products table. It has been generated locally; this document does not claim it has been applied to production.

Deploying before the migration keeps the existing catalog available: supplier writes are disabled with an explicit migration message and costs are unknown. Backup manifests use the database's recorded migration version so an unapplied supplier table is not assumed to exist. New backups after migration include supplier offers.

After an authorized release, use the repository's migration runner with privately configured production credentials, after confirming the existing migration journal and appropriate backup. Do not rerun the old schema repair, seed, owner creation or `db:push`. Verify the new table, test one private supplier offer, check preference switching and confirm retail/stock/orders remain unchanged. Do not reimport the full original catalog to backfill costs, since that could republish listings being consolidated.

Rollback application code independently while retaining this additive table. Do not drop the table after recording offers. Retain the captured catalog and alternative URLs; consolidating storefront duplicates should preserve referenced variants/order history and arrange old-URL redirects.

## Validation and live limits

Required checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, with MySQL integration tests in CI, and the existing production artifact/build checks. Local database tests skip when `TEST_DATABASE_URL` is absent; that is not proof of transaction behavior.

Live admin/public navigation remains affected by HTTP 429. Latest recorded health probe on 2026-10-09 at 15:01:41 UTC returned 429 with both Cloudflare and Hostinger CDN identifiers. No DNS/CDN/reaper settings were changed. The owner's account-wide process reaper and Hostinger parked-domain duplication remain investigation items. Provider authentication and a working origin are required before live UI verification, migration or duplicate consolidation.
