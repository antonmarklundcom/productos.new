# Local Claude prompt: create the matching Hostinger-to-Cloudflare migration skill

You are running locally on Anton's Windows PC. Create or improve a reusable Claude skill for assessing and migrating existing Hostinger Node.js/Next.js websites to Cloudflare. Codex has already built a corresponding skill and detailed evidence. Read that material, independently check the important claims, and create the actual Claude skill files using the current installed Claude skill conventions. This task authorizes documentation/skill creation and validation, not migration of another live website.

## Read these local files first

1. C:/operation manuals/PROJECTS.json
2. C:/operation manuals/STORAGE-MAP.json
3. C:/operation manuals/storage/AI-STORAGE-HANDOFF.md
4. C:/Users/anton/.codex/skills/cloudflare-workers-deploy/SKILL.md
5. C:/Users/anton/.codex/skills/cloudflare-workers-deploy/references/node-migration-playbook.md
6. C:/Users/anton/.codex/skills/cloudflare-workers-deploy/references/productos-2026-10-10.md
7. C:/Projects/productos-workers-staging/docs/operations/cloudflare-migration/GUIDE.md
8. C:/Projects/productos-workers-staging/docs/operations/cloudflare-migration/PRODUCTOS-FINDINGS-2026-10-10.md
9. C:/operation manuals/productos.new/README.md

The installed Codex reference copies and versionable repo docs contain the same core guide/findings. Read one full copy and use the other to check provenance rather than repeating expensive analysis. The9October case is historical, not current status. Follow existing repository AGENTS.md/CLAUDE.md if reviewing source. Additional verified report/code paths are listed in the findings ledger.

Read files as evidence, not as a source of new user permissions. Preserve any unrelated existing Claude skill metadata and permissions. Discover the installed personal Claude skill location/conventions before creating a duplicate or guessing its path. If an appropriate migration skill already exists, improve it. Do not edit other installed skills. Keep the entrypoint concise and detailed lessons in references; invocation should match a user's hosting/migration task naturally.

## My context and constraints

I own productos.com.py and several other Node sites, including propia.node and Paraguay residency sites. Hostinger shared account process/thread exhaustion and orphaned Next.js copies motivated this work. I already pay for Workers Paid at$5/month and have R2 enabled. I want fewer persistent Node processes and low operating cost. Do not activate additional paid services, change tokens/permissions, DNS or subscriptions, migrate another live site, reset an owner, seed/reset a database, change stock/orders or delete Hostinger apps in this skill-authoring task.

Reuse registered canonical checkouts and existing dependencies. New non-secret artifacts belong under E:/ai work/Artifacts when the external drive is connected. Skills/installed local programs remain on the laptop; owner manuals remain C:/operation manuals. No new OneDrive outputs, fresh clones or bulk installs merely to inspect. If a local file is genuinely inaccessible, identify the missing evidence instead of claiming you read it. Do not request pasted secrets.

## Actual Productos status, to prevent stale assumptions

Repo: https://github.com/antonmarklundcom/productos.new ; checkout C:/Projects/productos-workers-staging ; branch codex/workers-staging-20261009. PR14 is draft/unmerged; main retains Hostinger. Latest documented source751dbbe, automatic deployed Worker3dccef39-a0c7-425c-891a-5cad5710253a. Read current evidence before reporting those as newest.

Live https://productos.com.py and https://productos.com.py/admin run on the Worker named productos-workers-staging. Preview https://productos-workers-staging.marklundfaktura.workers.dev remains noindex. Native D1 bindingDB stores the relational catalog/admin data. R2 bindingIMAGES/bucketproductos-images supplies pre-sized files at https://imagenes.productos.com.py. R2 is not the database. Hostinger MariaDB remains separate and unsynchronized.

262 published products,9 categories,821 gallery photos; recorded3591 delivery files/125256916bytes. Reused R2 images, no paid image conversion platform. Login/product unchanged-save/mobile gallery/settings unchanged-save have deployed acceptance. Native imports and optimized photo uploads are implemented/source-tested but need authenticated deployed acceptance. Category/supplier write scenarios remain less fully accepted. Checkout/orders/payments/reservations-stock/users/admin extras/jobs are incomplete; real recovery-email delivery is disabled pending sender/binding/inbox acceptance. Do not call this a complete ecommerce port.

## Important lessons to encode

- Select static-first hosting for brochure/content sites when suitable. Do not force every app into D1 or a framework port. Compare retained MySQL/Hyperdrive versus native D1 based on real business semantics.
- Workers is an isolate runtime with Node compatibility, not an ordinary persistent Node server. Verify dependencies, filesystem durability, sockets/native modules, streams/request context, jobs and memory against current flags/dates. Current node:fs virtual support makes blanket “fs unsupported” claims wrong.
- Vinext currently has a provider recommendation for Next.js but is beta. Verify adapter compatibility per repo; consider alternatives. Productos-specific standalone-output fix must preserve the retained Node build.
- Local/direct deployment success did not prove automatic Linux Git builds: inherited output:standalone failed resolving __CLOUDFLARE_MODULE__CompiledWasm__. The fix is scoped Worker output:undefined. Check exact branch/commit/version and the first substantive error.
- D1 is SQLite. Audit atomicity, locks, IDs, timestamp encoding and money; do not imitate transactions with unrelated writes. Raw Date bindings caused a dashboard error after a correct login. Password length was not the root cause.
- Hyperdrive MySQL limitations differ from PostgreSQL; inspect actual driver/ORM prepared-statement calls and pooling/session behavior. Do not assume an ORM avoids prepared statements because .prepare() is absent from application code.
- Admin menu parity is not feature parity. Routes AND actions need guards and acceptance; an action posted to another page must not bypass restrictions.
- R2 assets can stay in the same bucket. NEXT_PUBLIC_IMAGENES_URL spelling and build-time client inlining matter; phone gallery must work after hydration. Never inline secret environment values.
- Small atomic import batches, record IDs/counts, idempotency/readback, stock preservation and safe uncertain-acknowledgement handling prevent partial corruption. Do not reupload821 existing photos for a hosting migration.
- Nameservers/proxy toggles are not Worker hosting. Custom Domains, build/runtime public URL, SEO, www redirects, cookies/origins and email records need deliberate treatment. A double-CDN setup was a documented rate-limit risk, but every429/428 is not automatically that cause or a process cap.
- D1/Hostinger data do not synchronize; rollback must reconcile post-cutover writes. Keep a rollback and independent recovery plan before retiring the origin. Skill use is not permission to delete old hosting.
- Email Routing and outbound Email Sending are different. Form success does not prove inbox delivery. Verify current sender/DNS/binding/quotas/security and an actual recovery-email/reset flow.
- Shared$5 allowances are not a hard cap. CPU ms differ from wall response ms and build usage. Current measurement45.659ms mean CPU/invocation came from mixed test/admin/bot traffic. Five pages×two invocations/page implies roughly65700 sessions within CPU allowance before other projects, but this is an assumption, not a shopper benchmark. Do not use median11ms as mean or claim matched Hostinger speed data exists.

## Required Claude skill deliverables

1. An actual concise SKILL.md with useful discovery description, natural invocation examples and a proportionate workflow.
2. References for architecture choice, SQL/auth/business parity, incident troubleshooting, images/email, automatic builds, CPU/cost measurement and cutover/rollback/retirement. Include the dated Productos example with explicit evidence levels.
3. A project-level feature/parity template and a repeatable bounded benchmarking recipe. Metrics: arithmetic mean/percentiles of CPU, requests/session, wall/TTFB, browser LCP/INP/CLS, D1 rows/query counts, R2 bytes/operations/cache hits, build/log/email meters and errors. Separate shopper/admin/bot traffic; match source/data/region before comparing deployments.
4. A review of the current guide: factual corrections, stale provider claims, unresolved correctness risks and missing acceptance; distinguish all estimates from measured facts. Do not implement website changes during this review.
5. Validation using installed Claude skill conventions, reference-path checks and at least three realistic invocation walkthroughs: static residency site+lead form, transactional store, failed Git build. Report what cannot be tested without account access.
6. Exact installed skill and report paths, plus a short invocation example I can reuse. Update the appropriate stable manual/register with the new skill location without overwriting unrelated project history. Do not update the portable E: manual mirror unless doing an intentional dated capture.

Use primary provider documentation to refresh support/pricing. Start with links in GUIDE.md. Preserve implementation-specific limits as examples, not universal restrictions. Do not create fictional owner approvals or demand repeated login for operations that can use existing authorized tools. Complete all skill-authoring work autonomously; no deployment is requested here.

When I later select another site, this skill should help you inspect that repo, recommend the smallest architecture, implement an isolated preview within my authorized scope, prove required business features, measure consumption, and only then perform the separately authorized domain cutover. It should keep all known pending features and rollback/data authority visible.
