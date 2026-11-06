# Catalog improvement batch 1 — 6 November 2026

Scope is the first ten items from the November catalog audit. The existing production flow is a WhatsApp-first catalog on Cloudflare Workers with D1 and R2. Run the acceptance checks on synthetic preview data before releasing shared behavior.

## Reuse in another catalog

- Use the storefront's existing brand, public contact configuration, policy pages, and settings overrides. Fill each store's verified identity, data handling, delivery, pickup, returns, and tax wording before publishing its policy copy.
- Keep the selected variant and product URL in the product-specific WhatsApp action. Check the mobile action and keyboard path, plus a transactional fixture to catch regressions in stores that enable checkout.
- Review publication requirements against the store's modes. Inquiry listings need an active variant to build an actionable inquiry. An intentional showcase may be display-only.
- Choose a small search relevance fixture based on terms shoppers use. Check literal results, curated alternatives, suggestions, and their result totals together.
- Regenerate the native Worker share fallback from the new store's `public/brand/mark.svg` with `node scripts/generate-catalog-share-image.mjs`, then commit `public/assets/catalog-share.png`. Check that actual homepage and photo-less product metadata point to it and that a real product image still takes precedence.
- Use each store's own provider bindings, credentials, catalog data, and recovery destination.


## Store configuration

For a catalog already using the native Worker, the owner can edit **Ajustes → Páginas** for `Privacidad`, `Términos y condiciones`, `Envíos y entregas`, and `Cambios y devoluciones`. **Ajustes → Envíos y devoluciones** holds the two shorter summaries beside the product action. Review storefront and detail price language together before making any tax claim.

Staff with catalog access can use **Productos → Revisar ofertas Dropi**. Start with missing dates and checks older than 30 days. Open the exact offer from its SKU row, compare the current supplier cost and availability with the prior capture, and record the checked date. Supplier captures are separate from the store's inventory.

## Inquiry measurement

The native Worker has an opt-in public funnel. With `WORKERS_INQUIRY_METRICS_ENABLED=true` set for that store, a visible eligible product page records `product_view`, and its inline or sticky WhatsApp link records `whatsapp_click`. The request has a fixed event name, a public product ID, and click placement when applicable. It uses no analytics cookie, third-party script, message text, contact details, user identifier, or referring page path. The endpoint stays disabled by default and honors Global Privacy Control. Hosting may still retain its normal request logs.

Before turning it on, confirm the owner's public privacy copy, who will review the counts, and the provider's log retention and sampling. In Workers Logs, filter structured application events on `metric = catalog_inquiry`. Group by `event` and `productId`, using the same time window. Separate the two click placements when evaluating the mobile CTA. Public counts can include repeat visits, repeat clicks, and automated traffic.

The operator uses the private sales inbox to tally **received**, **qualified**, and **sold** conversations independently by week. Record aggregate totals and optional product ID only, with no phone numbers, chat text, or customer names in the reporting sheet. Count a new conversation once at each milestone. Use one reporting timezone and consistently count the week in which each milestone occurred. Compare weekly totals in this format:

| Week | Product views | WhatsApp clicks | Received | Qualified | Sold |
| --- | ---: | ---: | ---: | ---: | ---: |
| YYYY-Www | | | | | |

These are aggregate stages. Clicks estimate handoffs and are not proof a message was sent. Ratios across stages for a week are directional because conversations can qualify or close in a later week. Do not match logs to individual people.

Provider instructions: [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

## Recovery readiness

Use the existing [D1/R2 recovery runbook](workers-recovery.md) and [encrypted bundle procedure](workers-recovery-bundle.md). Production capture depends on a private independent destination and key custodian, a consistency window, and confirmation of retention and recovery targets. Use an immutable source or coordinate a short write pause before a consistent export. Copy and verify D1 data, required R2 objects, and private configuration. Validate the encrypted bundle at the independent destination. Only record hashes, counts, and restore timing in the owner manual. Use a separately authorized isolated environment for a restore exercise.
