# Native D1 catalog/admin staging — 9 October 2026

## Deployed scope

Preview: https://productos-workers-staging.marklundfaktura.workers.dev/
Admin login: https://productos-workers-staging.marklundfaktura.workers.dev/admin/login
Repository: antonmarklundcom/productos.new; branch codex/workers-staging-20261009; draft PR14 remains unmerged.
The new staging DB is Cloudflare D1, not Hostinger or Hyperdrive. No production DNS, main-branch, order, stock, customer, account or R2 object changes were made.

D1 DB productos-workers-staging, binding DB, ID 5c87a1b7-adc8-4201-9326-c1d0ae09a49f. Two generated native SQLite migrations were applied to this new DB only. Catalog: 262 products, 9 categories, 821 gallery references and 262 historical supplier alternatives; storage 802816 bytes at import. Sources were the selected public fixture C:/dev/workers-local-productos/catalog-public.json and costs matched by Dropi ID in C:/AI research and to do/dropi-catalog/catalog-latest.csv. No older 269-product import, customers, orders or users were copied. Historical supplier stock is not store stock; captured offers are unconfirmed and not preferred. Review them before using margin filters. Known sharpener duplicates still require identity review.

Existing optimized WebP delivery stays on https://imagenes.productos.com.py. No image upload/conversion ran. The native product sample displayed its name and ₲69000 price, kept its Dropi URL private, and returned five valid WebPs totaling 83890 bytes at the sampled 480px sizes. This is an HTTP check, not phone-render verification.

## Boundaries and implementation

Public catalog/help/search and protected catalog/category administration are the pilot scope. Native adapters use SQLite Drizzle, UTC text dates, checked integer PYG values, request-scoped DB and session-secret access, shared D1 login counters, and atomic supplier/category batches. MySQL callback transactions are rejected before callback execution; they are not simulated. Checkout, payment, orders, imports, stock adjustments, uploads, user management, integrations and cron are deliberately blocked, including server-action IDs posted to another page. Existing role and session-version guards remain.

All Worker-generated responses prohibit shared caching/indexing. This is intentionally conservative for admin isolation, not the final storefront caching strategy. The Vite adapter has reviewed source transformations for SQL, cookies and supported actions; source drift requires regression checks. Normal Next.js/Hostinger source behavior is unchanged. Do not merge this experimental branch into main yet.

## Credentials and first private login

SESSION_SECRET is already installed as a new staging-only Worker secret; no value is stored here. There is no staging user and production cookies/accounts cannot log in. The owner can create the first staging owner privately from an interactive local terminal:

```powershell
cd C:/Projects/productos-workers-staging
pnpm workers:create-owner
```

It asks for email, display name and a new staging-only password twice with hidden input. It refuses to reset an existing active owner. It writes only to the explicitly bound staging DB. No public setup endpoint exists. Do not paste credentials into chat or commit them.

Authenticated HTTP testing remains pending explicit approval: automatic approval review rejected a temporary staff account plus unpublished test product. No such account/product has been created by that test. Therefore authenticated login/save/category/supplier UI is NOT yet accepted.

## Build, deploy, verify

Workers Builds must watch codex/workers-staging-20261009, not main, for the separate productos-workers-staging app. Commands: pnpm build:vinext, then pnpm deploy:vinext. D1 binding/flags/public URLs are versioned in wrangler.jsonc; SESSION_SECRET remains a provider secret. Do not add Hostinger DATABASE_URL or production setup/payment/upload credentials. Do not deploy ignored local config. D1 migration commands are not part of ordinary deploys; the two present migrations are already applied.

```powershell
pnpm typecheck
pnpm lint
pnpm test --maxWorkers=1 --no-file-parallelism
pnpm test:workers-preview
```

13 Worker policy/regression checks pass. Typecheck and full lint pass. Final deployment version 1e07fb1c-0299-49e7-968f-edb4e78c2b82. Seven HTTP checks pass, including actual email/password form fields, unauthenticated admin redirect, public product name/price and five valid existing R2 images. Full suite initially: 1099 pass, four template-sync Git tests exceeded 30000ms, 846 MySQL integration cases skip without TEST_DATABASE_URL. Focused rerun of the template-sync file with --testTimeout=120000 passed all 11 tests in 199s; the original 30s gate remains recorded as a timeout failure. Native remote D1 integration previously passed 18 checks (constraints, atomic preferred-source switch and failed-batch rollback, counters), with disposable records removed.

pnpm test:workers-d1 does NOT write by default: it requires --allow-disposable-writes, refuses any existing users/orders or changed fixture counts, and removes only its own records/restores captured ordering. Use only while the isolated fixture is disposable; it is not a production test. Never redirect TEST_DATABASE_URL to D1 or the catalog fixture.

## Measurement and budget

Initial successful native product/home trace observations were 65/81 CPU milliseconds; a later small cold-version trace measured 189/259ms. These are actual Worker trace samples, not p95 estimates. Login error CPU is not representative of a successful login. Initial native wall times from Paraguay were roughly 1–3.6 seconds; D1 primary is ENAM, so database latency/caching needs improvement before production. Worker startup and D1 SQL duration are NOT per-request billable CPU.

Workers Paid currently includes 10M requests and 30M CPU milliseconds monthly across the account; overage $0.30/M requests and $0.02/M CPU ms. D1 includes 5GB, 25B rows read and 50M written monthly; overage $0.75/GB-month, $0.001/M read, $1/M written. These are allowances, not a hard $5 cap. Our 0.8MB catalog is far below storage allowance; shared traffic/CPU still determine the bill. R2 delivery is separate. Sources: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/d1/platform/pricing/ checked 2026-10-09.

Use Workers Metrics/Observability and D1 Metrics → Row Metrics. Next benchmark should collect repeated valid home/category/product/login/admin traces, including CPU p50/p95, wall time and row scans, while excluding image CDN requests from Worker app counts. Add grouped home queries and anonymous public caching with correct price/stock invalidation only after functional acceptance. Admin/auth responses must remain private. No production cutover decision has been made.

## Recovery and remaining work

Keep Hostinger/live DNS unchanged until authenticated tests, checkout/order transactional port, backups/recovery, cron and cost/latency validation pass. Rolling the Worker back to its previous snapshot version restores read-only visuals but does not revert D1 contents. Use D1 Time Travel only against this staging database after reviewing changes; no destructive restore/export ran. Stop/disable staging builds to pause this experiment; never repeat live schema repairs.

Remaining: first private staging account; approved authenticated tests; browser/mobile rendering; full transaction port; category/product duplicate review; caching and regional latency study; larger CPU distribution and monthly shared usage model. The earlier snapshot/Hyperdrive docs are historical alternatives, not the current default D1 mode. The old local port8790 server was stopped; the workers.dev preview works independently of this PC.


## Subsequent production preparation

See [production preparation](workers-production-prep-2026-10-09.md): zero fixture differences and identical262live sitemap URLs; opt-in anonymous catalog HTML cache/version partition; product-card prefetch disabled; staging remains noindex. This supersedes the blanket all-public-no-store description for eligible anonymous HTML only. Admin/private/no-store responses remain unshared. Owner now explicitly requested reusing the live login; source credentials are unavailable and private first-owner entry is still pending, rather than lack of general account-creation authorization. Automatic build error and business contact details still need owner inputs.

### Current owner authorization and deployed status

The latest owner request explicitly authorizes reuse of the live login in staging. It supersedes the earlier pending-authorization wording above. No staging user exists; production credentials are unavailable here. The remaining account step is private owner entry through workers:create-owner, not another permission request. The owner can choose the same live email/password (minimum12characters); no existing production account is read or reset.

Runtime81139eb deployed as cd0d9f03-ade9-4314-bcfe-aa9854e647b9. Read-only reconciliation passed262products/9categories/821images, matching the selected fixture and live sitemap URLs. Safe public-cache infrastructure and product-card prefetch changes are deployed; actual private,no-store catalog responses bypass the cache. Authenticated acceptance and automatic-build error diagnosis remain pending. See workers-production-prep-2026-10-09.md for current commands and evidence.