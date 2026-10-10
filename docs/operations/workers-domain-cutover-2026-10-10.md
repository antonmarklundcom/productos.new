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
