# Workers D1/R2 recovery and release checks

Reviewed 23October2026. This is the current native Workers catalogue, not the retained MySQL/Cloudinary runtime. No production backup, restore, schema change or R2 copy was performed by the fix task.

## What has been verified locally

Run `node scripts/verify-workers-recovery.mjs` after the frozen install. It creates its own temporary configuration and two separate local D1 stores, applies the actual versioned D1 migrations and synthetic catalogue records, exports them with the installed Wrangler, imports schema before data, then checks row counts, the price, the limiter index and foreign keys. It refuses remote flags, removes known Cloudflare API token/key environment variables, invokes only local commands and removes only its own verified temporary folder.

The source remains unchanged during the synthetic schema/data exports. This proves this local mechanism against the fixture. It does not prove a consistent live export, private settings decryption, owner login, R2 recovery or acceptable recovery time.

The rehearsal found that directly importing the full local dump can encounter a missing referenced table. Schema-first import followed by deferred foreign-key data loading avoids that ordering problem. Preserve the full original export; never improvise changes to the only recovery copy.

## Private recovery inventory

- Record the exact Git revision, D1 migration journal, schema/table inventory, row counts, export hashes and export/bookmark timestamps in a private manifest.
- Keep SESSION_SECRET and provider access in an independent private vault. The same secret is needed to decrypt stored integration settings. Never put values or reset URLs in a report, Git, screenshot or public export.
- Include the R2 media objects and a manifest of their immutable keys/hashes. SQL image references do not back up image bytes. Keep a separately verified copy outside the working bucket/account/device failure boundary selected by the owner.
- Capture non-secret Worker binding names, domains and build commands separately from private runtime values. An application rollback does not roll back D1 or R2 data.

## Plan an actual recovery before executing it

1. Agree the maximum acceptable data loss (RPO), outage duration (RTO), independent-copy location and retention. Current provider recovery/account state is unverified by this task.
2. Identify the exact production D1 database and image bucket privately. Cloudflare documents Time Travel for supported D1 storage; verify this database's support, available restore points and current retention. Do not restore the live binding as a rehearsal.
3. For an authorized export, establish a reviewed consistency procedure across schema, data and media. An export can block database requests; separate schema/data exports from a changing live source are not automatically one consistent snapshot. Prefer an accepted immutable recovery source or a deliberately coordinated write pause. Do not disable writes automatically.
4. Create an explicitly named, empty isolated recovery destination only after authorization. Give it no public custom domain, cron schedule, outgoing email/payment binding or production traffic. Check its ID against the approved target before any import. Never reuse the live database name or an existing populated destination.
5. Validate the full original export privately and retain it unchanged. Load all matching schema before data; use the documented deferred-foreign-key procedure where needed. Preserve complete table/index/trigger inventory and compare to the manifest. Do not blindly apply a current schema to an older export.
6. Require matching counts, intact foreign keys, expected order/counter invariants, media key/hash checks, preserved publication/hidden-price rules and private login/settings-decryption acceptance. Disable outgoing integrations while testing. A 200 homepage alone is not recovery acceptance.
7. Record elapsed recovery time and actual recoverable timestamp. Leave the recovered system isolated until the owner accepts the result and separately approves any cutover. Retain the previous database, bucket and rollback information.

## Release prerequisite for the review fixes

The generated `0003_oval_masked_marvel.sql` adds only the `workers_login_limits_starts_idx` index. Review/apply it through the separately authorized D1 migration procedure before releasing the indexed limiter cleanup. It was generated/tested and subsequently explicitly owner-approved, applied and verified before PR17 merged on23 October2026. This prerequisite is historical; do not reapply it as new setup. The cleanup deletes at most 32 expired counters per call and retains all current login/recovery windows. No cron is needed or enabled.

Build and verify from the reviewed branch: `pnpm typecheck`, `pnpm lint`, `pnpm test` against a disposable test database, `pnpm test:workers-preview`, `pnpm build:vinext` and the normal Next build when shared source changed. Never point TEST_DATABASE_URL at the real store or retained local catalogue fixture.

## Freshness and remaining validation

The existing public 30-second DTO plus 30-second full-prefetch budget remains the accepted catalogue policy. Admin changes can be visible sooner to private/cookie requests than anonymous caches. Immediate emergency unpublish needs a separately accepted invalidation policy; this task did not add a global purge or extend stale data.

Still pending: actual provider recovery/support inspection, consistent private export and independent R2 copy, isolated production-derived restore, owner RPO/RTO/retention approval and real-phone/network measurements. The synthetic private decryption/hash fixture and built-Worker login/session suite described below supersede the earlier local-fixture gap; they do not prove production disaster recovery. No new paid service, schedule or provider setting is required by the local fixes.

## Sources

- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) — provider recovery mechanism and support verification.
- [Cloudflare D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) — SQL import/export, table order, deferred foreign keys and export limitations.
- [Legacy MySQL recovery](../BACKUP-RECOVERY.md) — applies to the MySQL/Cloudinary runtime; its commands do not back up native D1/R2.

## Synthetic manifest, private fixture and media validation — 23 October 2026

`node scripts/verify-workers-recovery.mjs` now discovers all versioned SQL migrations at runtime. Its allowlisted JSON manifest contains revision, capture timestamp, migration hashes, SQL/schema hashes, catalogue counts and synthetic image keys/hash/size/dimensions. It copies tiny PNG original/card/thumb bytes between two separately persisted local Miniflare R2 buckets and validates restored bytes and MIME. Wrong key, missing image and changed migration manifest are explicit negative checks. Known Cloudflare credential variables are removed from Wrangler children; generated configurations have only local bindings and no outgoing integrations.

A separate isolated synthetic D1 fixture transfers only a randomly generated password hash, encrypted settings, owner role and session version using bound statements. Random plaintext and encryption key remain in memory. Validation executes the actual `src/lib/secret-box.ts` encryption/decryption implementation and bcrypt verification. This is a crypto/hash/session-version recovery proof, **not HTTP login, cookie issuance, session revocation or full application authorization acceptance**. It does not restore real integration_settings/users rows from a production export. The catalogue rehearsal independently checks enquiry publication, integer price and foreign keys. It does not assert public HTML hidden-price presentation; the browser suite owns that proof.

Manifest fields describe this immutable local fixture; they are not a production consistency protocol or a provider backup receipt. Schema/data export hashes identify the source artefacts; SQL restore queries and foreign-key checks validate restored catalogue data. Private audit/import-receipt rows are not exported into reports. No production scan/export, backup schedule, independent destination, retention, RPO or RTO has been activated.
