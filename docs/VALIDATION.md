# Productos implementation and validation report

## Delivery and repository

The destination repository started with only `.gitignore` at `9f04114b018f48dfc40bc009508c160b53bba7fa`. The documented bootstrap copied the verified ecommerce template `c5422e3c9184f0c4e4575da3db2774329d063214` while preserving the destination's Git history and origin. `.template-baseline` records that full template SHA and the `template` remote is configured.

The user's final instruction supersedes the original direct-main delivery: publish branch `codex/build-productos-store` as a **ready, non-draft PR to main**, and **do not merge**. Main remains the original initialization until the user merges the PR. The PR head SHA, URL, final CI state and completion time are recorded in the delivery message. The old Productos repository and Hostinger database were not changed.

## Completed store

| Area             | Result                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | Centralized Productos name, Paraguay Spanish/voseo, integer PYG, forest-green/sage identity, custom bag mark and SVG favicon                                                                    |
| Homepage         | Responsive hero, six category tiles, prominent search, featured selection, new-arrival section for a real catalog, shopping/help links and complete footer                                      |
| Categories       | Hogar y cocina; Herramientas y jardín; Tecnología y accesorios; Belleza y cuidado personal; Mascotas; Deportes y aire libre                                                                     |
| Browsing         | Template search, autocomplete, filters, sorting, wishlist, cart and order lookup retained                                                                                                       |
| Product pages    | Large selectable image gallery with accessible zoom/focus return, clear product title, existing price/variant/cart controls, service links, descriptions, verified reviews and related products |
| Mobile buying    | Template sticky purchase bar and stock/variant selector retained for real stock products; guest checkout remains available                                                                      |
| Demo             | One fictional headphones product, two consistent photos, benefit-led text, a labeled ₲ 149.000 sample price, story section and expandable FAQs; zero stock and disabled purchasing              |
| Help             | Editable shipping, returns, FAQ, terms and privacy content; real contact fields displayed only when configured                                                                                  |
| SEO              | Category descriptions, canonicals, sitemap, merchant/product structured data and analytics machinery preserved; no fabricated reviews or offers                                                 |
| Admin/operations | Original product/category/import tools, accounts, roles, inventory, order transitions, payments, backups, recovery, outbox, migrations and jobs retained                                        |

The demo is not a confirmed Dropi product. Dropi is the intended supplier source; no live supplier connection, stock synchronization, supplier ordering or payment integration has been configured. Real product facts must come from supplier data. The demo-specific story/FAQ copy stays local; real products use the editable product description and existing merchant settings.

## Demo isolation and assets

Preview requires explicit `LOCAL_CATALOG_PREVIEW=1`, a loopback database whose name ends in `preview_test`, and a loopback site origin. The seed additionally refuses `NODE_ENV=production`. Runtime production mode is allowed for the local production preview only under those isolation conditions.

The demo remains `showcase` with hidden commercial prices and zero stock. The template intentionally redacts hidden prices; the visible sample price is a separate presentation constant and does not alter that guard. The demo emits no price/offer structured data or purchase event. Its reserved product URL and both private image routes are unavailable outside the local preview. A legacy zero-price local demo variant was removed from the disposable preview only.

Two images were generated with Higgsfield GPT Image 2.5 **Sunburst / Medium / 1k**, using the first image as the reference for the second. Cost: **0.5 credits each, 1 credit total**, within the authorized 50-credit budget. The optimized WebP files are about 49 KB and 85 KB and live outside `public/`. No additional product was generated.

## Local validation

Runtime: **Node 22.23.3**, **pnpm 11.22.0**, **MySQL 8.4.11**, Chromium through Playwright. Development used separate disposable loopback preview and integration databases. No remote production credentials were available.

| Command/check                                                          | Result                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository access, documented bootstrap and store wizard               | PASS; destination history retained, pinned template copied                                                                                                                                       |
| `pnpm install --frozen-lockfile`                                       | PASS, including with NODE_ENV=production; an isolated fresh install also retained tsx and TypeScript with .npmrc production=false. Dependency versions and lockfile retained                     |
| `pnpm setup:doctor --skip-docker`                                      | PASS; exact runtime/pnpm and both remotes reachable; local MySQL used instead of Docker                                                                                                          |
| `pnpm db:migrate`                                                      | PASS; all 23 versioned migrations and supplemental migration work applied to an empty disposable preview DB                                                                                      |
| `pnpm db:generate`                                                     | PASS; no schema changes or migration drift                                                                                                                                                       |
| `pnpm typecheck` / `pnpm lint`                                         | PASS after fixes; webpack build also completes its TypeScript check                                                                                                                              |
| `REQUIRE_DATABASE_TESTS=1 pnpm test --maxWorkers=2 --reporter=verbose` | PASS: 173 files, **1,833 tests passed**, three explicitly explained skips below                                                                                                                  |
| Final `pnpm test:unit --maxWorkers=2`                                  | PASS: 90 files, **967 passed**, two template-only skips                                                                                                                                          |
| `pnpm reconcile`                                                       | PASS; totals and cross-table invariants reconcile in the disposable preview                                                                                                                      |
| `pnpm build`                                                           | PASS with **webpack**, prebuild translations and **cpus: 1**; both configured test-catalog and no-database builds verified                                                                       |
| Configured browser suite                                               | 33/34 passed initially; the sole contact assertion was corrected for the deliberately configured test WhatsApp; both storefront tests passed on rerun, covering all 34 distinct scenarios        |
| `pnpm exec playwright test --config=playwright.preview.config.ts`      | PASS: **4 desktop/mobile tests**, including loaded images, one product, positive sample price, search, category navigation, gallery switching/zoom/focus, FAQs, responsive widths and empty cart |
| No-database production browser checks                                  | PASS: **3 tests**; visible non-empty homepage, CSS/JS, all six categories/search/help routes on mobile, honest health JSON, protected version endpoint, and disabled demo routes                 |
| `pnpm preflight`                                                       | EXPECTED FAIL: Cloudinary and merchant WhatsApp are missing; other banking/payment/notification/backup prerequisites are reported. Sales are not ready to open                                   |

Configured browser checks exercised guest transfer checkout, shipping selection, authoritative price changes, admin authentication/authorization, order dispatch/tracking, notes/order editing, product administration, CSP/hydration, enquiry/showcase restrictions and JavaScript budgets. Compressed script sizes observed: home ~231 KB, product ~240 KB, checkout ~237 KB, within the template budgets.

The three test skips are intentional: the template-only default-brand assertion, the template's removed `tiendas.json` registry assertion, and the live Pagopar sandbox test because no sandbox credentials were supplied. **No local MySQL integration suite was skipped.**

## Failures found and corrected

- Initial template-specific assertions treated the ordinary word “productos” as a forbidden brand occurrence or expected the old hero/skin. Brand checking now inspects actual text literals/JSX with a regression test; the real centralized-brand guard remains. SEO, translation references, helper WhatsApp links and the explicitly gated preview API check were reconciled with this store.
- A full validation wrapper attempt stalled during the early test run and was stopped. Its stages were completed and reported individually; the wrapper itself is not claimed as a successful run.
- The first added storefront browser assertion assumed every contact page was unconfigured, although checkout fixtures intentionally configure WhatsApp. Its corrected assertion passed.
- A production smoke test exposed inherited `app/loading.tsx` streaming a 200 before a missing product's 404. The global loading boundary was removed, and the local-only product guard plus actual HTTP 404 were verified. CSP and authorization were not relaxed.
- Visual QA caught the zero-price display caused by the template correctly redacting showcase prices. The demo now shows a separate labeled sample value; hidden commercial prices, structured-data rules and checkout guards remain intact.
- Gallery zoom uses the standard dialog trigger so keyboard focus returns to the image button. Full-page screenshots temporarily disable sticky positioning and hide the off-screen skip link for capture; actual UI behavior stays enabled.

The test server logged aborted-stream messages during browser navigations/prefetch cancellation. Tests inspected actual rendered content and functionality, not HTTP 200 alone. No-database mode logs the expected settings fallback warnings and reports `db:false`; it is a preparation state, not a healthy configured database.

## Machinery and secret review

A staged tree comparison against the pinned template shows no changes under `src/domain`, `src/lib`, `src/app/actions`, `src/app/admin`, `src/app/checkout`, `src/db`, or `drizzle`; `pnpm-lock.yaml` and `next.config.ts` are also retained. Changes concentrate on storefront components, configuration/copy, product/category/search rendering, local preview assets/scripts, validation tests and deployment documentation. The documented wizard removes template-maintenance-only files.

`.env.example` has exactly the five startup variables. `.env.local`, private `.env.hostinger`, build output, dependencies and browser reports are ignored. The private deployment file contains fresh independent secrets and an empty database field, with no optional-integration placeholders. No credential values are included in this report or public artifacts.

## Before deployment and sales

1. Review and merge the PR yourself. Then deploy **main**, project root `/`, Node.js 22, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm start`, and `NODE_ENV=production` in hPanel. See [HOSTINGER-STORE.md](HOSTINGER-STORE.md).
2. Fill the private environment file's database URI in hPanel. For a new empty DB, run controlled setup with seed/force unchecked; for an existing DB, inspect compatibility, back up and rehearse migrations first. Existing owners and real orders must be preserved. Remove the temporary setup secret after initialization.
3. Add real Dropi/supplier products, verified images/specifications, variants, integer PYG prices and stock. Create/map the six categories in admin. Do not enable stock-mode sales before the remaining launch checks pass.
4. Confirm merchant identity, contact, policies, delivery cities/methods/prices, payment/bank configuration, Cloudinary receipt uploads and recovery/backup jobs.
5. Configure real GA4/Meta IDs, validate purchase events and catalog feeds, then test a real landing page and checkout before buying ad traffic. Conversion performance requires live measurement; this build does not establish a sales uplift.

Hostinger deployment, domain/proxy behavior, existing-database compatibility, real Pagopar payments, Cloudinary uploads, notification templates and live ad tracking remain **unverified** because access and real business data were not supplied. The local build/rendering evidence does not claim that the old Hostinger blank-page issue has been fixed on its live server.
