# Catalogue completion batch — 23 October 2026

Repository: antonmarklundcom/productos.new. Registered checkout: C:/Projects/productos-workers-staging. Reused installed dependencies; C-only work. No fresh clone, provider configuration change, paid service, production export or live form submission.

PR17 and PR18 are historical merged/deployed fixes. This follow-up branch is codex/productos-catalog-completion-20261023, based on released main27659fdbbe4478cddcaf51b8b5deb13363313643. Implemented, validated, merged and deployed status must remain separate.

## Repeatable local checks

- pnpm typecheck / pnpm lint / pnpm test against a disposable TEST_DATABASE_URL containing test. Never target real store data.
- pnpm test:workers-preview for native policy/cache/SQL/transform fixtures.
- node --import tsx --test tests/workers/catalog-durability.test.mts for actual local native receipt/revision batches.
- pnpm exec tsx scripts/verify-workers-catalog.mts for catalogue atomicity, stock and media write regressions.
- pnpm test:workers-recovery for schema-first synthetic Wrangler D1/R2 recovery. Uses generated local configurations and task temporary paths.
- pnpm build:vinext, then pnpm test:workers-browser against that exact dist. Do not rebuild shared dist concurrently with browser acceptance.
- pnpm profile:workers-browser for bounded synthetic loopback route/cache/paint/navigation observations. pnpm profile:workers-search for in-memory SQL comparisons.
- pnpm build plus pnpm test:deployment for retained Next standalone compatibility. After Vinext generated route definitions, pnpm exec next typegen before Next typecheck/hooks if required.

Use process-only task TEMP/TMP at C:/Claude 1/.task-temp/productos-completion-20261023 and pnpm_config_verify_deps_before_run=false when reusing this verified dependency tree. No OS/global cache or TEMP changes are required. Task-owned synthetic MariaDB is loopback3317; its fixture data is separate from retained applications. Stop owned test processes after validation.

## Guides

- [Durable imports, revisions, history and migrations](catalog-durability.md)
- [Synthetic recovery and actual provider recovery limitations](workers-recovery.md)
- [Read-only offline media integrity](workers-media-integrity.md)
- [Spanish search contract, costs and diagnostics](workers-search.md)
- [Built-Worker browser acceptance](workers-browser-acceptance.md)

## Deliberate limits

Keep the accepted30-second DTO plus30-second client-prefetch freshness budget. Emergency faster hiding requires a chosen bound and measured invalidation design. Diagnostics remain off in production. Image request priorities are retained without representative matched waterfall evidence.

Adaptive canvas image preparation has bounded retries, progress and cancellation; physical-phone quality/memory/EXIF/orientation and dedicated worker evaluation remain separate. Desktop mobile emulation does not prove physical touch, screen-reader or carrier performance.

Owner choices: recovery loss/outage/independent destination/retention; audit/import receipt retention; optional live inventory/profiling. No backup schedule, live provider scan or cleanup is activated. New additive D1 migrations require explicit production approval before dependent release. Retained MySQL is a compatibility path, not proof of an active Hostinger deployment.
