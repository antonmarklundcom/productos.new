# Home page cache and robots.txt — 17 November 2026

Why: Workers Logs showed `/` at ~168 ms CPU per request (~70% of Worker CPU) and `/robots.txt` at ~35 ms. The existing anonymous HTML cache lived only 30 s per data centre, so most home visits were misses.

- Home (`/`, anonymous, no query, no cookie/auth/RSC): HTML stored in its own Cache API namespace (`catalog-html-home-<version>`) for up to 10 minutes. Served without any check for 30 s; after that each hit costs one small D1 read (catalogue fingerprint: products count/revision sum/max updated_at, categories, store_settings.updated_at) and re-renders when it changed. Fingerprint is read before rendering and the 30 s data cache is off for that render, so an entry cannot freeze older rows. Fingerprint failure means no store and no stale hit.
- Edits therefore show on the home page within 30 s (the previous documented bound was 60 s). No global purge exists; entries are per data centre and per deployment.
- Response header `x-home-cache: HIT|MISS|BYPASS` (home only). Existing `x-catalog-cache` is unchanged.
- Kill switch: env var `WORKERS_HOME_CACHE`, on unless set to `0` (then the old 30 s/60 s behaviour returns). Not set in `wrangler.jsonc`.
- `/robots.txt` on the production origin is a constant response before any render/D1 (`workers/d1/robots-response.mjs`); `tests/unit/robots-constant.test.ts` keeps it in line with `src/app/robots.ts`. Non-production origins keep Disallow-all.
