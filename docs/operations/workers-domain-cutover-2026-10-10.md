# Domain cutover and usage — 10 October 2026

The existing Worker `productos-workers-staging` is being promoted to serve productos.com.py. Source stays on `codex/workers-staging-20261009`; PR14 remains unmerged. Build and runtime NEXT_PUBLIC_SITE_URL must both be https://productos.com.py. Public WhatsApp is the owner-supplied 595995628862; no email address is invented. The existing D1 and R2 resources are reused; no product/photo reimport, migrations, passwords or stock changes are required.

## Routing

Attach productos.com.py and www.productos.com.py as Worker **Custom Domains**, not CNAMEs to workers.dev. Routing is managed in Cloudflare's dashboard/API independently of the source build. Only the configured live apex/www pair redirects to HTTPS apex; preview stays accessible and noindex. Non-canonical POSTs are rejected instead of forwarding Server Actions across origins. Existing private cache/noindex guards remain. WORKERS_PRODUCTION_READY is enabled only for the configured HTTPS live origin. workers.dev and private/admin responses remain noindex. Live robots/canonical/contact acceptance is still required after routing.

## Rollback

Record domain settings before applying. To return to Hostinger, detach only these two Worker Custom Domains and restore DNS-only CNAMEs: apex -> productos.com.py.cdn.hstgr.net and www -> www.productos.com.py.cdn.hstgr.net. Do not change imagenes/R2, nameservers, email records, D1 data or SESSION_SECRET. D1 and Hostinger are separate databases: reconcile any post-cutover edits before switching back. No orders/payments are enabled in this catalog pilot.

## Acceptance and remaining work

Verify HTTPS apex, www redirect with path/query, categories/contact/product, same-host admin login/save, private supplier references, responsive galleries, canonical/sitemap/robots and Git-triggered deployment. Current subset supports catalog, login and product/category administration. Checkout/orders/payments/stock mutation/import/uploads/settings/cron are deliberately blocked pending native D1 implementation. Recovery email stays disabled until a verified Email Sending domain, binding and real inbox/reset test exist. These limitations must remain visible in the owner report.

## Usage

Workers requests/CPU, Builds minutes, D1 reads/writes/storage, R2 storage/operations, outbound Email Sending, inbound Routing and Logs have separate meters. Account allowances are shared across projects; the existing $5 subscription is not a hard spending cap. Visitor analytics is not billable request count. Static pre-sized R2 photos need no paid image-transformation service. Refer to current provider pricing, not historical estimates.

## Completed live acceptance — 10 October 2026, 05:28 UTC

Source ee1af48d69cbad708bcc173ec60b74bb2f6f6253 deployed automatically in build 0f40678e-7369-4fb6-bd01-4c841b910edb; Worker version 7993efb6-9f9e-43e6-9032-ac8c432fdc27. GitHub checks/tests/e2e and Workers Builds succeeded; Lighthouse skipped. The source PR14 stays draft/unmerged; this release is watched directly from codex/workers-staging-20261009.

Both HTTPS custom domains attached at 05:18:48 UTC. productos.com.py serves the Worker; www redirects to apex preserving paths/queries. Cloudflare manages their DNS and TLS. Existing Hostinger CNAMEs were renamed to rollback-hostinger.productos.com.py and rollback-hostinger-www.productos.com.py, retaining targets and DNS-only mode. R2 imagenes, nameservers and the existing TXT/email record were preserved. No new paid service was enabled.

Acceptance: health reports db:true with262 products/821 images/9 categories; home, all 9 category pages, contact and policy pages return200. Canonical/sitemap use the live origin and sitemap lists262 products; workers.dev stays noindex. Unauthenticated admin redirects to login and remains no-store/noindex. Phone390px gallery5/5 images loads, category drawer navigates, public price69000PYG and configured WhatsApp link display; desktop1440px and phone have no horizontal overflow. On the same deployed version, the existing authenticated workers.dev owner saved product1 unchanged; reload and a read-only D1 check confirmed updated_at05:23:18 while enquiry/public-price/category/publication/private supplier fields persisted. No live-host password/login was performed; the owner must sign in once on productos.com.py using the existing Workers owner account. Category/supplier write acceptance is not newly confirmed by this unchanged-product test.

Rollback: detach ONLY apex/www Worker Custom Domains, then rename rollback-hostinger back to @ and rollback-hostinger-www back to www. Keep their original Hostinger targets DNS-only. Do not change R2, email, nameservers, D1 or session secret. Reconcile any edits since cutover because D1 and Hostinger databases are not synchronised. Custom Domain routing is dashboard/API-managed; source has no routes list and the existing automatic deployment retained it.

Current additional charges are $0.00; account usage September11–October11:991 requests,53.92k CPU ms,1.1k log events,11 build minutes. CPU share0.1797%; builds 0.1833%. Shared account usage is not a customer benchmark. At10 dynamic requests/visit,30/60/150ms average CPU gives about100000/50000/20000visits per month within30 million CPU ms, before bots/admin/other projects. Visits are not unique people; all other service quotas still apply. Public HTML currently bypasses cache due to private/no-store framework responses; no cache-hit savings are claimed. D1 payload819200bytes; R2 payload125256916bytes/3591deliveryfiles; no reupload.

Remaining: native checkout/orders/payments/stock/import/upload/settings/cron work; verified Email Sending sender/binding and real inbox/reset acceptance; better anonymous catalogue caching/performance and visitor analytics onboarding; catalog duplicate review. Current supported launch is catalog/enquiries and protected product/category/supplier administration, not a checkout-ready store. Owner actions: test the live admin with the existing Workers credentials and inspect the catalogue on phone. Do not repeat database repair, seed, media upload or owner creation.

Local checks: typecheck/full lint/Vinext build and38 Worker checksPASS. Full suite1,104 PASS / 846 MySQL SKIP / one synthetic Git timeout; the unchanged failed test passed isolated retry. Normal pre-push1,069 PASS / 2 SKIP. Hosted acceptance above passed with no 429/5xx. Reports and screenshots: E:/ai work/Artifacts/productos.new/2026-10-10/domain-cutover/STATUS.md.
