# Productos cost review results - 10 October 2026 Paraguay

Application revisions pushed only to `codex/workers-staging-20261009`: ab51cd1 and002aa69. The automatic build for002aa69 succeeded and deployed version e9a15b13-2df2-4f2f-80b8-2622e7f306da at2026-10-11T01:48:05Z. Main and provider build settings are unchanged. A subsequent benchmark-only fix removes Wrangler's invalid sampling-rate1 option and reports tail startup failures; it does not change application rendering.

## Bounded before/after from Paraguay

Each phase made9 sequential public HTML requests: home, category and product,3 each. Country PY, edge GRU. The after phase started cold for each path and then hit twice. CPU is actual header-filtered Cloudflare invocation data, not HTTP time. Before tail captured4/9 invocations; after captured9/9. p95 uses nearest rank and is diagnostic at these small sizes, not a population p95 or a monthly bill forecast.

| Metric | Before | After |
| --- | ---: | ---: |
| Probe HTML requests |9|9|
| HTML cache hit rate |0/9 (0%)|6/9 (66.7%)|
| Mean CPU / invocation |207.5ms (n=4)|38ms (n=9)|
| Observed CPU p95 |345ms (n=4)|190ms (n=9)|
| Mean TTFB / headers |2321ms (n=9)|651ms (n=9)|
| Observed TTFB p95 |3651ms|2038ms|
| Warm-hit TTFB mean / p95 |none|92/126ms (n=6)|
| Worker wall mean / p95 |2008/2561ms (n=4)|544/1724ms (n=9)|
| Desktop homepage dynamic Worker requests before any click |5|1|

Requests were not reduced in the direct9-request HTTP probe; the browser reduction comes from removing4 speculative RSC category requests. Cache API hits still invoke the wrapper, count as Worker requests, and consumed small CPU in this probe. Static Assets continue direct delivery. The first after probe had no CPU because the collector rejected sampling-rate1; its HTTP record is retained as after-first-no-cpu.json, and the corrected full trace is after.json. No production load test was performed.

## Actual D1 rows per public render

The isolated profiler preserved original query results, then replayed raw/first SELECTs through all() to get rows_read metadata. Replays are extra read-only diagnostic queries, excluded from CPU/TTFB measurements. A controlled original-homepage variant used the six pre-change category calls; the after variant used final batched selection. No writes, schema changes, private SQL parameters or customer data were exported.

| Page | Before cold queries / rows read | After cold queries / rows read | After warm hit |
| --- | ---: | ---: | ---: |
| Home |56 /2602|26 /1379|0 /0|
| Hogar y cocina |21 /1177|21 /1177|0 /0|
| Adaptador product |23 /450|23 /450|0 /0|

Home cold scans fell47%, and query count fell54%. At this probe's one-miss/two-hit mix, those three route profiles imply roughly334 D1 rows per HTML request after versus1410 before; this derived mix is not an account-wide per-visitor metric. Product/category miss queries remain candidates for further batching if future usage warrants it.

## Placement, freshness and real-user measurements

D1's primary region is ENAM; read-only metadata showed ORD. Default mode-off versus configured-smart isolated previews both entered through GRU and returned no cf-placement header. Their9 cold-request means were1766ms versus1796ms (p95 2137/2609ms), with no invocation CPU available for preview URLs. A later smart-preview warm check returned HIT on each repeated path, but no execution relocation was proven. These measurements do not establish Smart Placement benefit or harm. The live placement remains unset; automatic review rejected enabling it under the owner's no-settings-change instruction. A temporary live experiment requires explicit clarification/approval. Placement can change the execution centre and its local Cache API population; measure cold and warm paths together.

Catalogue price/stock display accepts a maximum60second delay after an admin edit. No automatic global purge is implemented. Versioned namespaces separate deployments. Cookie/auth, admin, RSC, actions, filtered/query and private/no-store/non-200/Set-Cookie/nonce responses do not share the public cache. Checkout remains disabled and must use fresh transactional data if later ported.

Cloudflare Web Analytics was already enabled, excluding EU traffic. Workers CSP now permits its exact public origins. Live browser verified script200 and managed /cdn-cgi/rum204 beacons, with no duplicate manual snippet or GA4. Dashboard: https://dash.cloudflare.com/95f6079b8f08477bb39b66552101cb91/web-analytics/overview?siteTag~in=d83432a717654c36afe3a1d5bf0c3741&excludeBots=Yes . It is free; browser script/managed beacons are separate from application Worker invocations. Use it for mobile experience, while account cost comes from requests/SUM CPU, D1 rows/storage, R2 operations/storage and builds/logs.

## Checks and remaining work

Typecheck/lint/hooks PASS. Full source1111 PASS/846 local MySQL SKIP;49 Worker tests PASS; final Vinext build PASS. GitHub source checks and MariaDB tests for002aa69 passed; browser e2e was still running when this source report was written. Live browser: mobile layout, GET search with22 results/no suggestion Server Actions, five-image gallery selection/zoom and contact link removal PASS; no page errors. Desktop/phone preview:1 initial Worker request, category click, gallery and404 tracking removal PASS. Live cookie/admin/query bypass, health262products/821images/9categories and www308 PASS. Existing production records/images were not changed.

Pending: conclusive live Smart Placement A/B; meaningful real-traffic averages/p95 and account cost forecast after enough visitors; remaining transactional/admin migration and email recovery delivery acceptance. Main/Hostinger-legacy switch is a separate task after review. Dated JSON evidence and screenshot: E:/ai work/Artifacts/productos.new/2026-10-10/metrics-fix/. Owner manual: C:/operation manuals/productos.new/README.md.

[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Web Analytics](https://developers.cloudflare.com/web-analytics/about/), [D1 billing metrics](https://developers.cloudflare.com/d1/platform/pricing/), [Placement](https://developers.cloudflare.com/workers/configuration/placement/). Cost formula and rollback commands: workers-public-cache-2026-10-10.md.
