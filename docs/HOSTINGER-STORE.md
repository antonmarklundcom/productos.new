# Productos: deploy and opening checklist

Repository: `https://github.com/antonmarklundcom/productos.new` · Branch: `main` · Domain: `https://productos.com.py`.

The destination was inspected at its initial commit `9f04114b018f48dfc40bc009508c160b53bba7fa` (only `.gitignore`). The documented `bootstrap:repo` copied template commit `c5422e3c9184f0c4e4575da3db2774329d063214`. `.template-baseline` records that full SHA; the destination's Git history/origin was preserved and `template` points to `antonmarklundcom/ecom`. The old Productos repository is not involved.

## Hostinger settings

The storefront has been merged into `main`. Select `main` for deployment.

| Field           | Value                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Repository      | `antonmarklundcom/productos.new`                                                                  |
| Branch          | `main`                                                                                            |
| Project root    | `/`                                                                                               |
| Runtime         | Node.js 22 (validated locally with 22.23.3)                                                       |
| Package manager | `pnpm@11.24.0`, matching the Hostinger build environment                                          |
| Install         | `pnpm install --frozen-lockfile`                                                                  |
| Build           | `pnpm build`                                                                                      |
| Start           | `pnpm start`                                                                                      |
| Environment     | `NODE_ENV=production` in hPanel                                                                   |
| Public origin   | `https://productos.com.py`, or the selected temporary Hostinger URL until domain mapping is ready |

`build` executes `next build --webpack`. The template's `prebuild` generates client translations; its single build worker, upload limits, security headers and external `mysql2` configuration remain. `.npmrc` keeps build dependencies installed even when Hostinger sets `NODE_ENV=production`, so the default install command can still run `tsx`, TypeScript and Tailwind during the build. This does not change the production runtime mode. System fonts need no build-time Google Fonts connection. Keep the lockfile; do not deploy `.next` or `node_modules` from this checkout. Hostinger supplies the process port.

In the dropdown-only installer, choose **pnpm run build**, package manager **pnpm**, and output directory **.next**. The pnpm pin matches the 11.24.0 invoked during Hostinger's build; the previous 11.22.0 pin failed Corepack's version check after dependency installation.

The app explicitly builds `output: "standalone"`, matching the server package detected in Hostinger's successful deployment log. `postbuild` copies `public` and `.next/static` into `.next/standalone`; Next's default standalone output omits them. The generated entry point is `.next/standalone/server.js`, which reads Hostinger's `PORT`. The importer keeps its detected Next.js entry setting. For a manual standalone launch use `node .next/standalone/server.js`; `pnpm start` remains available for a full checkout preview.

Run `pnpm test:deployment` after `pnpm build`. CI copies only the standalone artifact as physical directories to a temporary directory outside the checkout, loads both `mysql2` entry points, starts it with Node, and checks HTML, every referenced CSS/JS asset, a public image, and health without a database. This catches missing published files that a full-checkout `next start` or a link-preserving copy can hide.

`pnpm-workspace.yaml` sets `nodeLinker: hoisted`. In deployment `01a11214-4480-73a6-aee8-ad57d93d889d`, Hostinger resolved the external MySQL driver at `node_modules/mysql2/index.js`, where it could not find `sql-escaper`; loading the instrumentation hook failed and every app route returned 500. Copying the old isolated pnpm artifact as physical directories reproduces that exact error. The hoisted layout makes dependency resolution independent of virtual-store symlinks, without adding duplicate direct dependencies or changing the lockfile's versions. Use a clean install when validating a linker change. [pnpm nodeLinker documentation](https://pnpm.io/settings/node-modules#nodelinker).

The five-value import example below contains placeholders only. Generate three independent strong random secrets and fill values privately in hPanel. Never reuse the local test environment.

```dotenv
DATABASE_URL=mysql://MYSQL_USER:URL_ENCODED_PASSWORD@MYSQL_HOST:3306/MYSQL_DATABASE
SESSION_SECRET=changeme-generate-a-private-random-secret-of-at-least-32-characters
NEXT_PUBLIC_SITE_URL=https://productos.com.py
CRON_SECRET=changeme-generate-an-independent-private-random-secret
SETUP_SECRET=changeme-generate-an-independent-temporary-private-random-secret
```

`NODE_ENV=production` is a separate Hostinger setting. Cloudinary, WhatsApp, Pagopar and analytics belong in `/admin/integraciones`; bank/SPI details belong in `/admin/banco`. Do not add blank optional variables. Remove `SETUP_SECRET` and redeploy after controlled initialization/migration. Saving environment values does not rebuild the app: use Redeploy.

For this delivery, `.env.hostinger` is an ignored private file with freshly generated startup secrets and an intentionally empty `DATABASE_URL`. Import it privately in hPanel, then fill `DATABASE_URL` with the actual MySQL URI (`mysql://USER:URL_ENCODED_PASSWORD@HOST:3306/DATABASE`) and Redeploy. The app can display its preparation pages before a database is configured; `/api/health` honestly returns `db:false` until then. Never upload this private file to GitHub.

For a verified **new empty database**, visit `/setup`, enter the private setup secret, and create your real owner account while leaving both **seed** and **force** unchecked. This applies the versioned migrations without example products. Remove `SETUP_SECRET` from hPanel and Redeploy afterwards. Create the six initial categories in `/admin/categorias` or map them during catalog preparation, then add real products. For an existing database, follow the inspection and backup path below instead of running initial setup blindly.

## Existing database: inspect first

No Hostinger credentials were supplied, so its compatibility has not been established and no remote SQL has been run. Do not point the app at the old database merely because this repository is new.

1. With read-only access, inspect MySQL version, tables, `__drizzle_migrations`, schema columns and indexes against the 23 versioned migrations in `drizzle/`, including migrations 0018–0022. Check `products.sale_mode`/`show_price`, session-version and recovery/outbox/operation-key tables. Identify existing owners, orders and stock without exposing their private data in logs.
2. Take a full backup and verify restoration into a separate disposable database. Review [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md) and [TEMPLATE-HARDENING.md](TEMPLATE-HARDENING.md).
3. Rehearse the migration against that restored copy. If the old schema has tables but no matching migration ledger, **stop**: the initial migration will collide with existing tables. A reviewed schema diff and a correct adoption/baseline plan are required; do not fabricate migration entries or guess the starting version.
4. Only apply the reviewed versioned path after compatibility is confirmed. Do not use `db:push`, reset/truncate, `seed:true`, the demo script, `force:true`, or an owner password reset on an existing production database. A migration-only setup request uses `{}` with the temporary setup secret.
5. Existing products must be reviewed in `/admin/productos`. Until real data is confirmed, use `showcase` (no purchase controls or server checkout eligibility), with hidden prices. `enquiry` is appropriate only after real contact details exist. Enable `stock` products only after the opening checklist below passes. A fresh empty database contains no sellable products.

## Local preview and replaceable content

Use a disposable loopback MySQL database whose name ends in `preview_test`, and an ignored `.env.local`. Set its database URL, a loopback `NEXT_PUBLIC_SITE_URL`, the generated startup secrets, and the optional `LOCAL_CATALOG_PREVIEW=1`. Run:

```text
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm preview:catalog
pnpm build
pnpm start --hostname 127.0.0.1 --port 3100
```

The seed is refused on remote databases, ordinary database names and with `NODE_ENV=production`. It prepares one fictional headphones showcase product, zero stock, and a clearly labeled sample price of ₲ 149.000 shown only in the isolated preview. Its hidden commercial price and showcase mode prevent orders and price/offer structured data. Two Sunburst 2.5 Medium images cost 1 Higgsfield credit in total, within the authorized 50-credit budget. Private optimized WebP assets are served only when the preview gate passes. It creates no customer, order, payment, shipping promise or banking data. The local production server displays the demonstration notice and uses `noindex`. Do not run `db:seed` or `demo` against production.

The six categories cover a broad supplier catalog without a crowded navigation: home/kitchen, tools/garden, technology/accessories, beauty/personal care, pets, sports/outdoors. Dropi is the intended supplier source, not a verified live connection. Add real products through the existing spreadsheet import after mapping supplier IDs, variants, accurate stock/prices and image rights. No Dropi orders, stock synchronization or supplier purchase has been configured or claimed.

Use `/admin/categorias` to edit category names, descriptions and photos; `/admin/productos` and its spreadsheet import to replace products and select `showcase`/`enquiry`/`stock`. Use `/admin/ajustes` for contact, identity, hero, pages and accounts. Disabled custom policy copy is never exposed. Initial help pages display only preparation notices until confirmed copy is enabled. The default name, language, hero and initial category structure live in `src/config/tienda.ts`.

## Required before enabling sales

- Genuine catalog: suppliers, accurate descriptions/photos, integer PYG prices, tax treatment, variants and audited stock.
- Merchant identity and responsible operator; real WhatsApp/email, address and hours.
- Confirmed delivery/collection methods, cities, prices and any applicable limits. Review the template's fallback shipping behavior before opening.
- Bank/SPI details or verified Pagopar configuration; confirm any cash-on-delivery option with the actual delivery service.
- Cloudinary where needed for uploads and backups, plus a tested recovery procedure. Optional analytics are disabled until configured.
- Reviewed shipping, returns, privacy and terms text; accounts remain optional and guest checkout remains available.
- Scheduled jobs and a green server-side `preflight`. Configure the expiry job every 15 minutes, daily backup at 03:00 Asunción / 06:00 UTC, and optional daily summary at 08:00 Asunción / 11:00 UTC, as in [DEPLOY.md](../DEPLOY.md).

## Verify the actual deployment

Record the selected repository/branch and full main commit. Inspect the complete build log (webpack and successful output) and startup log (correct app process/port). Check the mapped hostname and temporary hostname separately.

1. GET `/`: require non-empty HTML, the visible brand and hero, then confirm rendering in a real desktop and mobile browser.
2. Load the referenced CSS and JavaScript and inspect browser/network errors. Browse all six categories, search, product details and order lookup. An empty new catalog must remain usable.
3. GET `/api/health`: JSON with `ok:true`, `db:true`; `cron` must become true after the expiration job has run. HTTP 200 by itself is insufficient.
4. GET `/api/version` with the private cron secret in an Authorization header. Match `sha` to the deployed commit and check `builtAt` and Node version. Unauthenticated requests must be rejected. Keep secrets out of command history/logs.
5. Check admin login and unauthorized access. Once configured in staging, exercise guest checkout and order/inventory transitions before enabling real sales.
6. The preview illustration route must return 404 in Hostinger. There must be no DEMO products, invented prices or stock in its database.

For an empty HTTP 200, inspect the app's emitted response body and process directly, the deployed output directory, repository/commit selection, domain mapping and Hostinger proxy/startup logs. Compare the temporary hostname. Do not assume another rebuild resolves a host routing problem. These live checks require Hostinger access and the deployed cron secret; local verification cannot establish them.

For plain `Internal Server Error` on both `/` and `/api/health` after a successful build, collect **Node.js → Runtime logs** immediately after a fresh request. The health route normally returns JSON with `db:false` when the database is unavailable; a plain 500 on every route needs startup/process/proxy investigation. Record the first exception, entry file and listening port without copying environment values. The 2026-10-06 incident built successfully at both `40fef1d5` and `f2782ab7`; the subsequent runtime log identified the missing `sql-escaper` startup dependency described above. Reproduce that failure and validate the published dependency layout before declaring recovery; a successful build or the separate asset-packaging fix alone does not prove live recovery.
