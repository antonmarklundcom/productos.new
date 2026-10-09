# Workers database pilot and local catalog preview — 2026-10-09

Repository: antonmarklundcom/productos.new; isolated branch `codex/workers-staging-20261009`; draft PR14 stays unmerged. Production remains on Hostinger. This report supersedes earlier statements that request-scoped connections have not been implemented.

## MEASURED: implemented and exercised

- `src/db/request-context.ts` carries a separate Drizzle handle through AsyncLocalStorage for each request. The existing Hostinger pool remains available only outside that scope; a Worker request cannot fall back to the Hostinger pool.
- `workers/hyperdrive-database.ts` creates one mysql2 client per request, with `disableEval:true` and query protocol. It keeps the client until the response stream completes, errors, is cancelled, or the request aborts. Cleanup is idempotent; failed graceful closure destroys the connection.
- Drizzle's normal SELECT path uses `query`. Direct prepared-protocol execution, SQL writes, BEGIN and locking SELECTs are rejected in this public pilot. These checks supplement, and do not replace, database SELECT-only grants.
- Missing/invalid database configuration returns sanitized diagnostics: health is HTTP 200 with `db:false` and a code; catalog pages are HTTP 503. Driver text, SQL and credentials are not sent to the browser.
- The pilot requires an explicitly UTC origin default (`+00:00` or `UTC`) and a zero offset between NOW and UTC_TIMESTAMP. It issues no session SET and refuses SYSTEM/non-UTC defaults. This is a fail-closed public-read strategy, **not a completed UTC-independent transaction port**. Do not change production's global timezone to satisfy this pilot.
- The four route-policy tests verify anonymous GET/HEAD, noindex/no-store, streaming/CSP preservation, private/mutation rejection, and public help/search GET pages. Server-action autocomplete, admin, accounts, order tracking and checkout are intentionally unavailable.
- Fifteen database adapter unit cases cover configuration, UTC rejection, query protocol, concurrency isolation, streaming success/error/cancellation, request abort, HEAD and cleanup failure. They use fake clients; real Hyperdrive pooling/TLS is still untested.
- Final Vite build and Wrangler packaging passed: 7,163.23 KiB uncompressed / 2,337.55 KiB gzip with the final public-page whitelist. This is code size, not runtime RAM or billed CPU.

Final source checks: typecheck and lint PASS; full suite 112 files / 1,103 tests PASS, 76 files / 846 integration cases SKIPPED without TEST_DATABASE_URL. Four policy tests PASS. PR14 CI on the previous pushed revision passed checks, MariaDB tests and e2e; fresh CI after this commit must be checked separately. Main remained 8e7d8f1; no merge or history rewrite was needed.

## MEASURED: local catalog preview

Local URL: **http://127.0.0.1:8790/**. This URL works on this PC; it is not a phone-accessible internet deployment.

An existing portable MariaDB 11.4.9 binary at `C:/dev/tools/mariadb/mariadb-11.4.9-winx64` runs a new loopback-only instance on port 3308. Its data directory is `C:/dev/workers-local-productos/data`, separate from the pre-existing MariaDB data directory. Its origin default is UTC.

The disposable `productos_workers_preview_test` database was created from this branch's existing migration files and a catalog-only copy of the saved import export. This was **local disposable initialization, not production migration/repair**. No db:push, seed, owner creation, stock reset or production database command ran. Fixture facts: 262 products, 9 categories, 821 image references, zero customers, orders or users. Product descriptions/slugs/images came from the final 262-row CSV; prices, category names, stock and visibility came from the saved admin export. Supplier URLs were excluded. Publication timestamps are fixture timestamps, not production history.

The preview connection is granted SELECT only; a zero-row INSERT permission probe was denied with the expected ER_TABLEACCESS_DENIED_ERROR. Its private configuration stays in ignored local/generated files and is never committed or copied to manuals. An ignored generated local entry injects this loopback connection into the same built Worker adapter, without creating or inventing a Hyperdrive configuration ID. Local TCP is not evidence that Cloudflare can reach Hostinger.

18 actual public page probes passed (home, contact, shipping, FAQ, all 9 categories and 5 products), plus five health/HEAD/robots/private/POST probes. No private supplier fields appeared in their responses. HTTP timings for this short local run were p50 105 ms / p95 185 ms; **these are not Cloudflare CPU measurements or a traffic capacity forecast**.

Actual browser clicks navigated home → Autos y motos → a product → Contacto. All four Barra LED thumbnails and all five cleaning-brush thumbnails loaded existing R2 images, and selected gallery images rendered. No images were uploaded. The in-app browser's attempted viewport override did not change its measured width; Chrome control was unavailable. **390px mobile layout, mobile Lighthouse, and every image across the entire catalog remain unverified.**

Restart helpers are local under `C:/dev/workers-next`: `local-worker-config.mjs` regenerates ignored local runtime configuration after a build; do not deploy `dist/server/wrangler.local.json` or `local-preview.mjs`. The active preview uses `wrangler dev --local --config dist/server/wrangler.local.json --ip 127.0.0.1 --port 8790`. The versioned deploy script uses `dist/server/wrangler.json`, which contains none of these local credentials. If the PC or preview processes stop, Codex can restart them using the same isolated fixture; no hosting login is needed.

## MEASURED: provider readiness

The owner connected Worker `productos-workers-staging` to GitHub and selected this branch, with `pnpm build:vinext` / `pnpm deploy:vinext` and the two public build variables. CLI access can read deployments. Hyperdrive inventory is empty: no configuration, binding ID or safe remote origin credentials are available. The existing OAuth session lacks Builds API permission (read returned HTTP 403, code 12004); the in-app Cloudflare dashboard is signed out. No extra permission/token/login was requested while the owner was AFK.

Remote URL: https://productos-workers-staging.marklundfaktura.workers.dev. Before this change it served placeholder version `0dabb369-84e9-4958-a594-1b60dbc1be15`. Remote status after the real push must be recorded separately; a local build is not a deployed catalog.

## DOCUMENTED: Hostinger origin prerequisites and remaining owner work

Hyperdrive supports MySQL/MariaDB, requires origin TLS with valid certificate verification, and uses published shared Cloudflare source ranges. Cloudflare's mysql2 example requires v3.13+ and `disableEval:true`; this branch has v3.24.4. The Worker connects to the Hyperdrive-provided endpoint; origin TLS is configured/verified by Hyperdrive, not by disabling mysql2 certificate checks.

Hostinger's managed Remote MySQL guide documents a hostname and individual IPv4/IPv6 allowlist inputs. It does not establish that this Cloud Startup account supports range/CIDR entries or a CA-valid TLS endpoint. Repository notes about temporary Any Host troubleshooting do not establish a suitable production configuration. **Do not choose Any Host (%) for the production database.**

After the owner returns, obtain these facts from hPanel/Hostinger support:

1. Exact database hostname and port, whether TLS is supported, certificate hostname/issuer, and the CA chain if non-public. Verify using mysql2 with `ssl:{rejectUnauthorized:true}` and a session `SHOW STATUS LIKE 'Ssl_cipher'` diagnostic using a safe account; do not print passwords/connection strings.
2. Whether Remote MySQL can allowlist all of Cloudflare's published ranges, or which approved network approach Hostinger supports. An IP field alone does not prove CIDR support.
3. An isolated catalog database with UTC default and a SELECT-only user, or an approved read-only source with compatible UTC handling. The current global-UTC guard may reject the live Hostinger default SYSTEM even if one connection happens to be UTC. Do not alter the live server default.
4. Create a **Hyperdrive configuration**, initially with query caching disabled, for the verified safe origin. Attach it to this Worker as `HYPERDRIVE`. Only its non-secret actual configuration ID needs to go in `wrangler.jsonc`; credentials stay with the provider. No fake ID is present in this branch.

If managed Hostinger cannot satisfy TLS/range/UTC requirements, realistic options are an isolated MySQL copy on a compatible host, a verified private-network connector where a supported daemon can run, or a separate D1 conversion. No new host or subscription was purchased.

## DOCUMENTED / ASSUMPTION: all-Cloudflare option and budget

D1 is Cloudflare's SQLite database; Hyperdrive is a connector, and R2 holds photos rather than relational rows. Workers Paid includes 5 GB total D1 storage, 25 billion rows read/month and 50 million rows written/month. Overage is $0.75/GB-month, $0.001/million read rows and $1/million written rows. The allowances are account-wide. Rows scanned and index writes count. Worker CPU/requests, R2, builds and logs have separate meters.

ASSUMPTION: this new 262-product store would comfortably fit within D1's included database allowance. No D1 schema, data import or measured D1 usage exists. Porting MySQL to D1 requires query/schema and transaction/stock-reservation changes; the current branch still uses MySQL. The $5 subscription is not a hard spending cap.

## Still not done

Real remote Hyperdrive binding, origin TLS/firewall verification, deployed catalog rendering, Cloudflare CPU/memory measurements, phone/Lighthouse verification and write/auth/checkout transaction compatibility. The 846 existing database integration tests remain skipped in the full default run; the local catalog fixture was not assigned as TEST_DATABASE_URL and was not wiped by integration tests. No production merge, DNS change, live migration, account credential change or R2 upload occurred.

## Official sources

- https://developers.cloudflare.com/hyperdrive/examples/connect-to-mysql/
- https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/
- https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/
- https://developers.cloudflare.com/hyperdrive/configuration/firewall-and-networking-configuration/
- https://www.cloudflare.com/ips/
- https://www.hostinger.com/support/1583546-how-to-set-up-remote-mysql-access-in-hostinger/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/
