# Overnight review — Productos on Cloudflare

The live site/admin now run on the existing Worker/D1/R2 resources. Full role-authorised menu visibility is restored in this source revision with pending sections linked to an authenticated explanation screen. This does not implement pending order/payment/settings capabilities. Independent catalog hydration SELECTs are parallelised to reduce network waiting; query count and monetary/stock calculation are unchanged. A Workers-only homepage claim about order information is replaced with a working WhatsApp enquiry description. Hosted source/version acceptance is recorded in the owner report and manual after automatic deployment.

## Hostinger retirement

You can eventually remove this Node app; don't remove the hosting account or other apps. The current Cloudflare catalog no longer needs the Hostinger process to serve its supported routes. Keep the old app/data temporarily as rollback while checking required admin features, unported jobs/integrations, unique ignored configuration and a deliberate independently recoverable data export. D1 is a separate copy, not synchronised. No Hostinger deletion, cancellation or backup/export was performed. Full old backend parity is not complete; do not promise it when retiring.

## Differences

| Area | Hostinger version | Current Cloudflare version |
| --- | --- | --- |
| Runtime | Next.js persistent Node processes on shared process/thread budget | Worker isolates, compatible Node APIs and Vinext adapter; no Hostinger process for these routes |
| Database | MariaDB/MySQL, existing host DB | Separate SQLite D1 snapshot plus native catalog/admin operations; existing IDs retained |
| Images | Existing R2 responsive assets | Same bucket/files/URLs, no reupload or paid transformation |
| Admin | Full original menus/operations | Catalog/product/category/supplier operations; other sections pending, not functionally complete |
| Checkout/payments/stock | Original implemented logic needing real integration configuration | Blocked until a native atomic/tested port; catalogue enquiries work |
| Jobs/email | Host processes/cron/integration configuration | Cron unported; recovery email inactive until verified sender/binding/inbox test |
| Builds | Hostinger branch/build settings | Existing migration branch Git Builds, Vinext Worker bundle and Custom Domains |
| URLs/SEO | Same public routes on Hostinger | Same live routes/canonicals, protected admin and noindex workers.dev preview |
| Limits/cost | Shared host RAM/thread/process limits | Shared Workers CPU/request, D1 rows/storage, R2 ops/storage, builds/logs/email meters |
| Files/native tasks | Host filesystem/native Node capabilities | Runtime API-specific compatibility; durable assets/data in bindings, image conversion done locally |

We have no matched reliable Hostinger-vs-Workers benchmark with identical source/data/client conditions. Earlier 429/process failures contaminate the comparison. Initial Worker CPU median 57.43 ms and wall median 847 ms came from a mixed test/admin multi-version sample; latest public HTTP wall probes 1.2–3.2 seconds include client/network/DB waits. These numbers do not establish a speedup or a per-visitor bill. Cloudflare responses observed at GRU; D1 verification was served ENAM/ORD, so DB geography can still affect latency. Need controlled Paraguay browser cold/warm LCP/TTFB tests and CPU/query measurements before a performance claim.

## Resource improvements

Already present: locally pre-sized WebP/responsive R2 delivery, unoptimised image component avoiding paid runtime transforms, product-card prefetch off, request-memoised store settings/product metadata, capped CPU/request and private-response guards. This overnight change parallelises independent variant/image and reservation/rating reads; fewer sequential waits, same returned fields/calculations. Do not claim lower CPU/query count without measurement. Next candidates: batch homepage newest-category queries with equivalent ordering, eliminate unnecessary review/stock reads only in verified enquiry-only paths, cache safe anonymous catalogue HTML with invalidation/freshness tests, inspect D1 replication/session semantics and repeated request-level memoisation. Never trade stock/auth/data safety for a quota estimate. Current shared usage: 991 requests / 53,920 CPU ms / 11 build minutes / $0 extra; example: 10 dynamic requests/visit yields 50,000 visits/month at 60 ms CPU before other use. Shared quotas are not a hard spending cap.

## Assortment and design for tomorrow

Full latest Dropi file: C:/AI research and to do/dropi-catalog/catalog-latest.csv — 6,609 products. Expanded 6,635 includes historical rows; original 5,296 is baseline. Supplier and suggested retail prices are PYG, separate product/image/supplier URLs captured; not live guaranteed quotes. Tomorrow first consolidate visually/spec-confirmed duplicate listings into one public product with supplier alternatives, including the three sharpener candidates 13535 / 9710 / 15839. No catalogue rows/products/prices/images changed overnight. Test practical demonstrable products instead of adding hundreds without demand/cost evidence. Improve real samples, verified specs, unique copy, product demonstrations, honest delivery/returns and measured contribution margin. CDE/Paraguay distributor samples can improve fulfilment; China/regional import needs landed cost/MOQ/QA/working-capital analysis before claiming better margins.

Design priorities: home value proposition/search/varied curated products/truthful trust cues ; category mobile filters/clear cards/buying guides;then product gallery/use benefits/verified specs/strong WhatsApp enquiry and policy links. No fake urgency/reviews/bestsellers or unsupported AI product alterations. AI copy/images pilot 5–10 verified products first; SEO technical correctness and search intent can be improved, but no guarantee of perfect rankings or invented KWP volumes.

## Copy-ready prompts

- CLAUDE-CLOUDFLARE-MIGRATION-SKILL-PROMPT.md:full migration-skill task and detailed local/Git context.
- TOMORROW-CATALOG-REVIEW-PROMPT.md:whole-dataset analysis, canonical duplicates, margins, supplier alternatives, KWP drafts; evaluation only.
- DESIGN-SEO-AI-IMAGES-PROMPT.md:homepage/category/product priorities, truthful SEO/copy, small AI image pilot and performance acceptance.

Existing Codex deployment skill updated at C:/Users/anton/.codex/skills/cloudflare-workers-deploy/SKILL.md with references/node-migration-playbook.md. No duplicate skill or generic approval restrictions added. New skill validation and hosted/menu bug checks will be recorded after completion. Cloudflare dashboard browser signout requested; do it after deployment acceptance. No password/account change or existing CLI credential revocation.

## Source verification — 10 October 2026

Typecheck, lint and the Vinext build passed. Full Vitest suite: 1,106 passed, 846 skipped; MySQL integration tests were skipped because TEST_DATABASE_URL is unset locally. Workers guard suite: 39 passed. The first new sidebar test exposed concatenated accessible text; an explicit pending-status label corrected it, and the final full run passed. Pending menu links do not prefetch. The build preserves role filtering, same-origin checks and blocked unported financial actions. No migrations, product/data changes, media uploads or account changes were run.

The three detailed handover prompts are versioned under docs/operations/handoffs/ so cloud Claude sessions can use Git instead of inaccessible PC paths. The Codex deployment skill was extended with a reusable Node migration playbook. Its bundled quick validator could not run because the installed Python lacks PyYAML; manual frontmatter, reference and placeholder checks passed. No package was installed solely to validate that small skill update.

Browser control became unavailable after successful cutover and earlier phone/admin acceptance. A fresh tab attempt also timed out. Final authenticated visual acceptance and dashboard logout cannot be claimed unless browser control recovers. Public HTTP checks and automatic deployment evidence remain independently verifiable. Hostinger is retained, with a recorded DNS rollback and separate, unsynchronised databases.
