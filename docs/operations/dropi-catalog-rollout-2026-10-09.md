# Dropi catalog rollout report

Status checked on 2026-10-09 UTC. Repository baseline: `7e094f5dcadc6c1ed8939847e7a168e598be5031`.

## Result

The selected product images are uploaded to R2. Product import is **not complete**: the authenticated admin returned a generic server error before saving any products. The first attempt did create six categories. A subsequent preview still showed 25 new products and zero existing updates; the isolated one-product import also failed. Do not describe the prepared catalog as published.

| Item | Result |
| --- | --- |
| Verified Dropi candidate IDs | 269: original 250 plus 19 additional candidates |
| Prepared final assortment | 262: 244 original selections plus 18 additional selections |
| Held candidates | Seven: six exhausted supplier records and one identity conflict |
| Final deduplicated gallery entries | 821 |
| Uploaded delivery objects | 3,591 |
| Delivery storage | 125,256,916 bytes, approximately 125.3 MB or 119.5 MiB |
| Public representative photo checks | 845 captured source references returned HTTP 200 |
| Actual products saved in store | Zero confirmed |
| Retail estimates with at least 50% gross margin | 175 of the 262 selected records |
| Final intended categories | Nine |

The 845 source-reference checks are not 845 unique gallery photos. Duplicate image references within each product were reduced to 821 gallery entries. The uploader checks one representative WebP per source reference, not every public object byte. The earlier 22-object pilot additionally passed public byte/hash comparisons and rendered in the browser.

## Images

Images were downloaded from the authenticated product-page captures and resized locally using the merged photo pipeline. Delivery files include WebP sizes with longest-side targets 240, 480, 800 and 1200 where the original supports them, plus JPEG fallbacks for social/feed metadata. Small sources were not enlarged. Originals, private manifests and credentials were not uploaded.

The full 269-candidate source pool occupies 319,762,800 bytes in originals. Its generated variants occupy 129,013,657 bytes. This aggregate reduction does not measure an individual page transfer: a browser selects an appropriate variant rather than downloading every size.

The selected 262 delivery set uses approximately 0.125 GB of storage. Future additions, old versions and delivery operations should be checked separately in the account usage report. This report does not claim indefinite zero charges.

Eight source image URLs failed after retry and were excluded. A watermarked illustration for ID 14300 and a shipping-label image for ID 10146 were excluded. All candidate main photos were reviewed visually; every gallery photo was not individually reviewed. Six animated sources use their first frame under the existing pipeline policy.

## Categories and duplicate review

| Intended category | Products |
| --- | ---: |
| Hogar y cocina | 118 |
| Herramientas y jardín | 29 |
| Tecnología y accesorios | 28 |
| Autos y motos | 23 |
| Mascotas | 20 |
| Deportes y aire libre | 19 |
| Belleza y cuidado personal | 14 |
| Juguetes y juegos | 9 |
| Bebés y maternidad | 2 |

Toys were separated from kitchen/home listings. Baby and maternity items received their own category. Shoe drying, key holders and the kitchen lighter moved out of generic technology; body scales, camping lights and work lights were assigned by use.

The final file has 262 unique Dropi IDs, SKUs, slugs and public titles. Cross-product main-photo hash comparisons and gallery hash overlap found no identical images. This does not prove that every supplier listing represents a physically different item. Similar grooming brushes, kitchen tools and other supplier alternatives still require sample/specification comparisons before consolidating them.

IDs 4276 and 16431 initially had the same generic public title. Their captured images and descriptions differ; they were not treated as confirmed duplicate products. Their titles now distinguish the USB-C flashlight from the other LED flashlight. No unsupported lumen, range or durability claims were added.

## Prices and commercial limits

Each selected record has a proposed retail price in whole guaraníes, retained from the earlier recommendation. Exact captured supplier costs and supplier suggestions remain separate. For variants with cost ranges, margin uses the highest captured supplier cost conservatively.

- Gross margin amount = proposed retail minus supplier cost.
- Gross margin percentage = that amount divided by proposed retail.
- Markup percentage = that amount divided by supplier cost.
- Maximum procurement cost at a 50% gross margin = proposed retail multiplied by 50%.

A 100% markup corresponds to 50% gross margin. Neither measure is net profit after shipping, advertising, fees, tax treatment and returns. There is no verified Keyword Planner volume, sales evidence, conversion rate or supplier reliability rating. Proposed prices are test estimates, not validated market prices.

The file uses enquiry mode, hidden proposed prices and blank store stock. The importer would record new variant stock as zero. Supplier stock is not the store's owned or reserved inventory. Checkout and fulfilment readiness were not tested or enabled.

## Holds

Do not import IDs 22821, 13049, 18375, 20323, 14517 and 22174 until their supplier availability is reviewed: captured stock was zero. ID 14853 changed from a dispenser to a watch name and price while retaining dispenser images. Its product identity must be resolved first.

## Incidents and evidence

1. The public image variable initially missed its final letter: `NEXT_PUBLIC_IMAGENES_UR`. The owner corrected it to `NEXT_PUBLIC_IMAGENES_URL` and rebuilt. The live CSP was subsequently verified to allow the image hostname. Public image delivery also passed.
2. The website briefly failed after the DNS change. Later apex and www checks returned HTTP 200, and 21 first-party assets passed. Responses contained both Cloudflare and Hostinger CDN headers. The configuration therefore has two CDN layers. [Hostinger documents that this combination is unsupported](https://www.hostinger.com/support/hostinger-cdn-vs-cloudflare/). It is a plausible contributor to instability, not a proven cause of every failure in this run.
3. The 262-product admin preview passed: 262 products, 262 variants, 821 photos, zero existing updates. The first 25-product preview passed with 73 photos. Confirm/import created categories and then returned the generic message `No pudimos completar la acción. Probá de nuevo.` No products were found in the subsequent preview.
4. Admin subsequently showed its error boundary. Browser console reported an unexpected server response. Read-only public health/home/admin/sitemap requests returned HTTP 429. One response included `x-hcdn-request-id`, `cf-cache-status: DYNAMIC` and a Cloudflare server header, with no explanatory body. After backoff, the admin loaded again.
5. After recovery, the isolated one-product preview passed with five photos. Confirm/import failed again with the same generic error. Catalog export also returned the generic error. A smaller batch alone therefore did not solve the write problem.
6. The importer writes `sale_mode`, `show_price` and `dropi_url`. Its preview only reads a narrower subset of product fields. Missing migrations are one possible explanation for preview success followed by write/export failure. The live schema and server error log were not available, so this remains a hypothesis. Do not run a schema change on the basis of that hypothesis alone.

The next necessary evidence is the Hostinger deployment log entry `applyCatalogImport falló`, or a read-only live schema inspection. Admin authentication is working. R2 credentials work. Hostinger access is requested only for diagnosing the server failure, not for ordinary image upload or product import.

## Local deliverables

The operational files live outside Git under `C:/AI work/productos/store-import-262-2026-10-09`:

- `productos-262-import-final.csv`: final category/title corrections, proposed prices, stable IDs/slugs/private Dropi URLs and R2 references.
- `productos-precios-y-enlaces-262.xlsx`: all selected records, proposed prices, image counts, planned store links, Dropi/supplier links, conservative margin/markup formulas, procurement targets, risks and current status. Planned store links are not proof of live pages.
- `import-batches-small/batch-01.csv` through `batch-53.csv`: five-product batches, last batch containing two products.
- `import-batches/batch-01.csv` through `batch-11.csv`: the original 25-product batch plan, kept as an alternative after the server issue is fixed.
- `upload-report.json`: successful upload results and counts.
- `category-and-duplicate-review.json`: category changes, unique-key checks and the resolved generic-title collision.
- `import-plan.json`: final file hash and sale/stock policy.

The prior 269-product verification workbook and per-product UTC timestamps remain under `C:/AI work/productos/dropi-refresh-269-2026-10-08`. The main private media manifest remains under `C:/AI work/productos/images-269-2026-10-08`. Credential values are excluded from these reports and Git.

## What to do next

Follow [the import recovery runbook](catalog-import-runbook.md). Diagnose the first actual server error, inspect migration state if relevant, and fix the confirmed cause. Recheck the catalog before retrying because import is not atomic across all products. Start with one product, verify its public gallery and private Dropi link, then continue in five-product batches with checkpoints and backoff on HTTP 429. Do not re-upload the confirmed immutable media files.

The owner should rotate previously chat-pasted R2 credentials and replace them privately. Rotation was not performed or confirmed. Resolve the double-CDN configuration with the verified Hostinger Node origin, without guessing a shared-hosting IP or disturbing the R2 hostname or mail DNS.

No orders, payment setup, live database migration, DNS change or credential rotation was performed in this rollout attempt. No code fix is claimed by this documentation change.

## Validation of this documentation change

`pnpm typecheck` and `pnpm lint` passed. `pnpm test` passed 107 test files and 1,070 tests; 75 files and 840 integration tests were skipped because no disposable `TEST_DATABASE_URL` was configured. Production database credentials were not used for tests. The first sandboxed command attempts failed with a filesystem access error; reruns using the installed dependencies outside that restriction succeeded. Repository runtime and schema code are unchanged.

The product register was recalculated with Artifact Tool. All 262 row margins and markups matched independent calculations. Changing a proposed price recalculated the margin, and the original price was restored. Formula-error scan found zero errors. Both worksheets were rendered and visually reviewed; the saved XLSX ZIP passed integrity inspection, with 1,048 clickable link formulas and a filtered product table. No live Microsoft Excel session was used.
