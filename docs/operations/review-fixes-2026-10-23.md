# Productos.new review fixes — 23 October 2026

All ten reported bugs B01–B10 are fixed and checked locally on `codex/productos-review-fixes-20261022`, based on current main `f7ebe25427fc6afc23a8bf4b63750f3d396583fe` (includes merged PR16). Nothing has been pushed, merged or deployed. Migration 0003 is generated and tested locally only. The earlier report is historical evidence, not the current backlog.

## Five highest-value next tasks

1. Complete isolated browser/Workers admin acceptance: login roles, product/import/upload forms, missing/fake length and multipart action handoff.
2. Prepare a reviewed release: run remote CI, review/apply D1 migration 0003 before the limiter code, then separately authorize merge/deployment and verify the exact live version.
3. Establish private D1/R2/config recovery coverage and perform an authorized isolated restore; owner chooses data-loss/outage limits and independent retention.
4. Attribute cold homepage/search time using matched query/CPU/render/navigation traces and cache state before changing performance code.
5. Decide emergency-unpublish freshness and Spanish search expectations; validate on a real phone/carrier.

## Ranked bug register — fixed locally

### B01 — P2: Import categories stay consistent

**Status:** Fixed locally · unreleased. **Evidence:** `workers/d1/catalog-category-identity.ts:24`.

**Condition / impact:** Import a category whose saved slug differs from its display name, including renamed or inactive rows. Imports could duplicate categories or assign products to the wrong category.

**Fix:** Preview and writer share a canonical identity resolver, reject ambiguous aliases and validate the category snapshot inside the atomic batch.

**Acceptance / limits:** Custom slugs, renames, inactive rows, alias collisions, mixed new/existing rows and concurrent snapshot changes are covered by native fixtures.

### B03 — P2: Catalogue products use a working enquiry path

**Status:** Fixed locally · unreleased. **Evidence:** `src/lib/catalog-policy.ts:10`.

**Condition / impact:** A legacy stock row, a new product, or an import without an explicit sale mode in a catalogue-only build. Visitors could add to a cart that led to a deliberately unavailable checkout.

**Fix:** Shared capabilities enforce enquiry rendering, safe admin defaults and import validation. Enquiry links retain the selected SKU; ordinary Next commerce builds keep stock behavior.

**Acceptance / limits:** Policy/UI/native import tests cover legacy stock, enquiry links and capability separation. No production rows were converted.

### B04 — P2: Unavailable admin actions are explained

**Status:** Fixed locally · unreleased. **Evidence:** `src/components/admin/bulk-actions.tsx:89`.

**Condition / impact:** Try stock adjustment or bulk product actions in the native catalogue build. Operators could complete controls whose server action was deliberately disabled.

**Fix:** Stock and bulk controls are disabled with availability text. Existing server denials remain in place.

**Acceptance / limits:** Capability/UI tests verify the controls; full authenticated browser acceptance remains pending.

### B02 — P2: Login throttling stops unnecessary growth

**Status:** Fixed locally · unreleased. **Evidence:** `workers/d1/login-limit.ts:26`.

**Condition / impact:** Continue attempts from a blocked IP while changing email strings; accumulate expired limiter keys. Rejected requests could keep allocating persistent counter rows.

**Fix:** Email limiting short-circuits after an IP rejection; indexed cleanup removes at most 32 expired rows per call and preserves the longest recovery window. Generated migration 0003 adds the expiry index.

**Acceptance / limits:** Limiter/SQL tests cover blocked-IP allocation, active windows and bounded cleanup. Apply migration 0003 before releasing the cleanup code.

### B05 — P2: Literal admin search works on both SQL paths

**Status:** Fixed locally · unreleased. **Evidence:** `src/lib/sql-like.ts:4`.

**Condition / impact:** Search product names or SKUs containing %, _, ! or a literal backslash. Operators could miss matching products and exports.

**Fix:** One parameterized LIKE helper uses an explicit portable escape character; list and export use the same predicate.

**Acceptance / limits:** SQLite predicate fixtures and MariaDB integration tests pass for literals and list/export parity. Strict MySQL 8 CI remains unrun here.

### B06 — P2: Invalid category pages return 404

**Status:** Fixed locally · unreleased. **Evidence:** `src/app/categoria/[slug]/page.tsx:89`.

**Condition / impact:** Request page 999 or a page made invalid by category filters. Empty impossible pages were indexable and displayed invalid pager numbers.

**Fix:** The counted page boundary is enforced in metadata and rendering, using a shared cached read. A 404 is the selected policy.

**Acceptance / limits:** First/last valid pages, out-of-range pages and filtered counts are covered by page/canonical fixtures.

### B07 — P2: Category outages have a clear retry state

**Status:** Fixed locally · unreleased. **Evidence:** `src/app/categoria/[slug]/page.tsx:88`.

**Condition / impact:** The category product query fails while category metadata is still readable. Visitors were told there were no matching products.

**Fix:** A distinct unavailable state provides retry guidance, noindex and safe diagnostics; existing failed-reader cache protection is retained.

**Acceptance / limits:** Injected error and real-empty fixtures render distinct states; no private SQL text is shown.

### B08 — P3: Search text follows navigation and screen changes

**Status:** Fixed locally · unreleased. **Evidence:** `src/components/search-box.tsx:41`.

**Condition / impact:** Search A, search B, Back/Forward, or switch between desktop and mobile header instances. The input could disagree with the displayed search results.

**Fix:** A shared browser draft follows committed URL changes while preserving unfinished typing on the same URL.

**Acceptance / limits:** UI tests cover committed query changes, responsive instances and preserved drafts. A real-phone/history walkthrough is still pending.

### B09 — P3: Search can reach results after the first 40

**Status:** Fixed locally · unreleased. **Evidence:** `src/db/queries.ts:440`.

**Condition / impact:** At least 41 published products match, or a search page exceeds its counted last page. Additional matches were hidden and the first slice looked like the total.

**Fix:** Count and page use the same selected search predicate with stable name/id ordering, truthful totals and previous/next links. Invalid pages return 404.

**Acceptance / limits:** 41-match/native SQL and page UI fixtures cover count, publication filters, fallback, last valid page and page 999. Spanish ranking improvements remain separate.

### B10 — P3: Restricted staff get an authorized landing

**Status:** Fixed locally · unreleased. **Evidence:** `src/app/admin/(panel)/estado/page.tsx:68`.

**Condition / impact:** An existing vendedor signs in without a usable next route. A valid user could land on an unavailable orders route.

**Fix:** The native guard falls back to an authenticated availability page; its links are permission filtered and no dashboard counts are exposed.

**Acceptance / limits:** Role and generated-guard tests pass. No production account was created or used.

## Improvement backlog

### I04 — Actual request-body bound

**Implemented locally; full-flow check pending.** The wrapper reads actual POST bytes before action parsing and returns 413 above 1 MiB, even with absent or fake Content-Length. Tests cover the exact boundary, interrupted bodies, URL-encoded forms and an 800 KiB multipart body. The built local Workerd → Vinext invalid-login multipart action and exact 1 MiB boundary passed; oversized declared and chunked bodies returned 413. Authenticated upload/session acceptance remains pending.

### I06 — Search heading outline

**Implemented locally.** Added an H2 for search results; focused UI checks pass. Manual screen-reader/phone review remains part of release acceptance.

### I08 — Current operational notes

**Implemented locally.** KNOWN-ISSUES now identifies already-fixed examples and dated dependency constraints. Recovery docs distinguish native D1/R2 from legacy MySQL/Cloudinary.

### I01 — Recovery assurance

**Partly complete.** Added the native recovery runbook and passed a synthetic, local-only Wrangler export/restore with schema-first import, row counts, integer price, index and foreign-key checks. Actual provider restore points, private consistent export, R2 copy, owner login, settings decryption and timed recovery remain unverified. Owner chooses acceptable data loss/outage, retention and independent-copy destination.

### I03 — Emergency unpublish freshness

**Documented; owner decision.** The existing 30-second DTO plus 30-second full-prefetch budget is documented. Decide whether emergency removal needs faster propagation. No purge or longer stale policy was added.

### I02 — Cold homepage/search performance

**Open; measurement required.** Keep the bounded October 22 baseline. Capture matched query, CPU, headers/body, rendering and navigation traces before selecting a performance change. Current tests/build times do not measure visitor latency.

### I05 — Spanish search quality

**Open enhancement.** Brand/fallback and visibility are covered by pagination fixtures. Agree accent, case, multiword and ranking expectations, then measure failures and cost before choosing an index or tokenizer.

### I07 — Image priority tuning

**Open; measurement required.** Existing responsive variants remain. Compare mobile/desktop LCP, request waterfall, DPR and network conditions before changing eager-image counts. No image bottleneck was proven.

## Validation

|Check|Result|Evidence / limit|
|---|---|---|
|Frozen dependency restore|PASS|Existing registered C: checkout; no clone or copied node_modules.|
|Full Vitest suite|PASS|196 files; 1,985 passed, 3 skipped, 0 failed; isolated MariaDB 11.4 on loopback.|
|Workers tests|PASS|67 passed, 0 failed; bounded concurrency.|
|TypeScript and ESLint|PASS|Full typecheck/lint passed; normal pre-commit gates recorded below after commit.|
|Workers production build|PASS|pnpm build:vinext, including native bundle preparation.|
|Next production build|PASS|pnpm build, including standalone packaging; synthetic local configuration only.|
|Standalone smoke test|PASS|pnpm test:deployment: isolated startup, HTML, CSS, JS, public asset and health without a database.|
|Schema generation|PASS|D1 migration generated and exercised locally; pnpm db:generate reports no MySQL drift.|
|Synthetic D1 recovery|PASS|Actual installed Wrangler; four migrations, schema-first restore, counts/price/index/foreign keys. No production or R2 restore.|
|Independent final reviews|PASS|Sol 6.1 Medium agents found no blocking regressions across import, capabilities, pagination, auth, request limits, SQL helper and recovery claims.|
|Production release / real accounts / real checkout|NOT RUN|No merge, push, deploy, live migration/config/data write, account, form, message or paid-service activation.|

## Methods and performance limits

The 22 October inspection used 27 bounded public GETs plus sampled Chrome navigation. Observed HTML misses: homepage 1,768 ms (later 436 ms), category 301 ms, product 570 ms to headers. Warm HTML 95–150 ms; full search response 854–985 ms; synthetic category RSC 1,467 → 140 ms. These GRU/network/cache observations are not server CPU, browser paint, visitor percentiles or proof of a laptop RAM limit. Full methods, raw files and separate browser/SQL observations remain in the original report.

No new live performance claim is made by these fixes. Local test/build durations are verification costs. Search now has an additional matching count query; representative cold/warm query cost and tail latency must be profiled before any performance conclusion. Privacy/cache-isolation and existing absolute expiry protections were retained and covered by the Workers suite. The accepted freshness budget remains 30 seconds DTO plus 30 seconds full prefetch.

## Small release batches

1. Import identity and catalogue capability guards (B01/B03/B04): highest correctness benefit; no data conversion.
2. Limiter/index, role landing and request bound (B02/B10/I04): review generated index; apply before releasing cleanup; verify real action handoff in isolation.
3. Portable admin SQL (B05): run strict MySQL 8 CI in addition to local SQLite/MariaDB evidence.
4. Category/search/discovery (B06–B09/I06): verify canonical boundaries, history and responsive behavior. Search depends on count/query parity, not new FTS.
5. Operational docs/recovery (I01/I03/I08): native runbook and synthetic rehearsal are ready; private recovery and policy decisions remain distinct work.

The changes are one local review branch. These are logical review/release groups; cherry-picking requires dependency review. Do not split the limiter code from its generated migration.

## Checks retained honestly

An early typecheck found two new boundary typing errors; both were corrected and full TypeScript then passed. The first broad test run was aborted after missing synthetic SESSION_SECRET caused token tests to fail; the corrected full run is the passing 1,985/3 result. Initial recovery attempts exposed an unsupported export flag and full-dump foreign-key table ordering; the final schema-first procedure passed. The first MySQL drift command lacked DATABASE_URL; the corrected local-only command passed. One approval review timed out before execution; its permitted retry completed. No assertions, hooks or production protections were bypassed.

The three Vitest skips are the live-credential Pagopar sandbox case, a default-template customer-account flag expectation, and the template-only tiendas.json registry case. No live payment was attempted. Docker/MySQL 8 were unavailable locally; integration tests used a disposable installed MariaDB 11.4 process and a new synthetic test database, not existing application data.

## Not done / owner decisions

- No push, PR, remote CI, merge, migration application or deployment; local source and generated migration remain reviewable.
- No real checkout, production login/account, live admin submission, outgoing message or real payment. Native transactional orders/stock/payment features remain deliberately unavailable.
- Actual Workerd → Vinext authenticated action/multipart flow and real-device interaction remain pending. Node Request.formData fixtures and build success do not prove that full flow.
- No provider recovery-point/retention audit, private live export, R2 copy, settings-decryption/owner-login restore or measured real recovery time. The synthetic export is not a production backup.
- Owner decides maximum acceptable loss/outage, retention, independent-copy location and whether emergency removal must beat the current freshness budget.
- No speculative placement, cache, FTS or image-priority tuning. Current performance follow-ups need matched evidence.
- Work used C: only; registered checkouts/other worktrees and existing program data were preserved. No portable E: mirror update.

## Supplementary built-Worker action acceptance

A separate synthetic local D1 (all four actual migrations), independent local-only Wrangler configuration and the existing built bundle served /admin/login. The check followed the rendered client chunks to the actual server reference and used React encodeReply([FormData]) with x-rsc-action. Invalid-login multipart returned the expected generic error in a 200 text/x-component response; an exactly 1,048,576-byte valid multipart action also passed. An actual 1,048,577-byte chunked request without Content-Length and declared oversize both returned 413. The task-owned Wrangler tree was stopped and loopback refusal confirmed.

No valid account/session, authenticated upload or production request was used. URLencoded is not this login form's actual client action format; contradictory HTTP Content-Length framing cannot represent the Request-level fake-small-header fixture, so those unit-test limits remain explicit. An initial missing ESModule rule in the independent configuration was corrected and retained in the result record. This closes the invalid-login parser gap, not full authenticated admin/browser acceptance. Non-secret result: C:/Claude 1/reports/productos.new/2026-10-23/fixes/local-action-acceptance.json.
