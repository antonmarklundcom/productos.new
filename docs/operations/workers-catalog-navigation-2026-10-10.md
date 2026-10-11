# Cloudflare catalog navigation and restart check — 10 October 2026

The staging Worker uses native D1 with the existing R2 image URLs. A PC restart does not stop this hosted service. The owner admin session remained authenticated when inspected.

## Implemented

The Vite/Workers build selects `workers/d1/catalog-capabilities.ts` through an explicit alias. Normal Next.js selects `src/config/catalog-capabilities.ts` and retains full navigation. The enquiry catalog hides cart, customer-account, favourites and order-tracking entry points because their backing operations are not ported. Category menus, search, product links and contact/help pages remain available. Admin text describes the actual catalog editing capabilities without promising orders or stock operations.

No database migrations, catalog re-import, photo re-upload, stock/order change or password change is needed for this fix.

## Deployment status

The automatic Cloudflare build at commit 539b870 failed; its substantive diagnostic is still unavailable. GitHub code checks, MariaDB tests and E2E passed; Lighthouse was skipped. The Cloudflare check contains a link and build ID but no error message. Do not call this an automatic deployment repair until its log is read and a Git-triggered deployment succeeds.

Existing CLI OAuth was refreshed without increasing access. Zone productos.com.py is active. Direct Worker version 21db1a68-b6fc-4616-a7e2-2100d59f464e was still active at this check; no website Worker custom domain was attached. The dashboard was signed out after the restart.

## Remaining

1. Owner signs into the Cloudflare dashboard privately; inspect failed build 2e94c43c-b1fc-4bb4-b4eb-e9cdbed70b1a and fix the first substantive failure.
2. Verify this navigation change in the hosted Worker, including a phone-width menu and gallery hydration.
3. Supply actual public WhatsApp/contact email for enquiries, then configure and test the CTA.
4. Set the production site URL at build/runtime and the reviewed production switch; verify canonical/robots/sitemap.
5. Replace the Hostinger website origin through a Worker Custom Domain, handle www redirect/TLS and verify public/admin/R2 routes. Keep Hostinger/main as rollback; leave imagenes and mail DNS alone.
6. Activate verified Email Sending and test owner recovery separately. CLI owner-password reset remains available while email is disabled.

The existing D1 admin supports product/category/supplier editing. Checkout, payments, stock operations, imports, uploads and other unported routes remain blocked. Moving DNS alone does not enable them.
## Validation and hosted acceptance

Typecheck PASS; full ESLint PASS on bounded direct CLI diagnostic after stalled initial runs; changed-file lint PASS; Workers build PASS; 33 Workers checks PASS. Full Vitest PASS:113files/1105tests passed;76files/846tests skipped because TEST_DATABASE_URL was unset. The successful run used two workers and small synthetic fixture scratch under C:/dev/productos-small-test-scratch-20261010, taking155.44seconds. Earlier external-scratch runs were stopped after long Git-fixture delays. No real database was started/copied or modified; source/build dependencies stayed in the existing checkout and reports stayed on E:.

Direct staging version 3dcbed41-b740-4364-8dfa-4776015de2e5 is deployed from these pending navigation changes. Home/category/product/health HTTP200; catalog counts262/9/821 retained; unsupported public links absent; supplier URLs absent in checked public HTML. Phone390px category menu navigates; content width375px. Owner admin still authenticated; all five product1 gallery images load from R2. First generic Python user-agent request returned403; browser and an identifying deployment-checker user-agent returned200. Automatic Git deployment remains unverified/failed at prior commit; this direct deploy does not repair that check.
