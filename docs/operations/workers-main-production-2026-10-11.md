# Live Cloudflare production from main — 11 October 2026

The live https://productos.com.py website is served by the existing Worker named productos-workers-staging. The name does not mean this is a separate staging website.

PR14 merged as 99c7b89b76f74e5745c78c0d4e6a359d520e03c0; its Git tree exactly matches the approved review head 70f95559a2bb393b6d296bcac2a62359197356ad. Both main GitHub CI and MariaDB test workflows passed. This documentation commit triggers the first production build after selecting main in Cloudflare.

## Production workflow

Cloudflare: Workers & Pages > productos-workers-staging > Settings > Builds > Production branch: main. Build command pnpm build:vinext; deploy command pnpm deploy:vinext; root /. Push reviewed improvements to main through pull requests; the production build then deploys this same live Worker. Verify the main source commit, successful build, active version at 100% and https://productos.com.py/api/health.

Keep the existing DB, IMAGES and CF_VERSION_METADATA bindings, runtime variables and encrypted SESSION_SECRET. WORKERS_D1_STAGING=true remains required by the current implementation despite its name. Placement and the separate Runtime Cache setting stay unchanged.

## Live improvements and verification

Anonymous home/category/product HTML has a 60-second public Cache API TTL. Cookie/auth/admin/RSC/Server Action/private responses bypass shared caching. Edits accept up to 60 seconds of displayed price/stock delay; no global purge is implemented. Homepage D1 reads and speculative prefetch requests are reduced. Catalogue-only order lookup links and unavailable search suggestion actions are removed; normal GET search remains available. Existing free Cloudflare Web Analytics CSP is repaired.

Measured results and limits: [10 October cost report](workers-public-cache-results-2026-10-10.md). After this build, check health counts (262 products, 821 images, 9 categories), anonymous MISS then HIT, cookie/auth/query/RSC bypass and unauthenticated admin redirects. A successful build does not establish new real-traffic averages or a Smart Placement benefit.

## Recovery and scope

Previous known-good optimized production version: ab237335-c387-4d0d-9b65-5a8ef3fd0d9f. If application rollback is needed, use Cloudflare deployment history or pnpm exec wrangler rollback ab237335-c387-4d0d-9b65-5a8ef3fd0d9f --config wrangler.jsonc, then verify the live site. Application rollback does not restore data.

Old Hostinger source is preserved by hostinger-legacy and hostinger-final at 8e7d8f195df7366901c4afd5acd1dc1c9c23ae4e. Hostinger administration and deletion are excluded from this live Cloudflare task. These Git refs preserve committed source, not private configuration or database backups.

Final deployment evidence belongs in C:/operation manuals/productos.new/README.md and E:/ai work/Artifacts/productos.new/2026-10-11/main-transition/REPORT.md. Do not commit secrets or customer records.