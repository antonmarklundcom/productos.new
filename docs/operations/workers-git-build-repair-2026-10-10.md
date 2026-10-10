# Workers Git build repair — 10 October 2026

## Confirmed cause

Cloudflare build `20f2e1f3-26a6-4d51-8fb0-30f014019cb7`, source `2d0704d`, failed during Building (before Deploying):

> Error: Failed to resolve required runtime dependency "__CLOUDFLARE_MODULE__CompiledWasm__" for standalone output

The stack runs through Vinext `copyPackageAndRuntimeDeps`, `emitStandaloneOutput` and `finalizeBuild`. The shared Next configuration uses `output: "standalone"` for Hostinger. Vinext inherited it and tried to package a Cloudflare virtual Wasm module as an ordinary Node dependency. Local Windows build/direct deployment success did not prove the Linux Git pipeline would succeed.

## Scoped repair

Vite passes the shared Next configuration to Vinext with `output: undefined`. Headers, image settings, public build metadata and other shared behavior remain inherited. Next configuration uses `satisfies NextConfig` to preserve its exact field types for the adapter override; this changes type validation only, not runtime behavior. Normal Next/Hostinger still emits standalone output.

No dependency, new service, token/access grant, database change, photo upload, owner credential or DNS change is required for this build fix. No upgrade or paid add-on is authorized.

## Verified dashboard configuration

- Repository: antonmarklundcom/productos.new
- Production branch: codex/workers-staging-20261009
- Root: /
- Build: pnpm build:vinext
- Deploy: pnpm deploy:vinext (generated dist/server/wrangler.json)
- Build/runtime public site URL: https://productos-workers-staging.marklundfaktura.workers.dev
- Build/runtime public images URL: https://imagenes.productos.com.py
- DB binding: existing productos-workers-staging D1 database
- SESSION_SECRET: encrypted, value not read
- CPU limit: 1000 ms; WORKERS_PRODUCTION_READY: false

These settings are already correct; no dashboard edit was made. Push this repair to the staging branch, watch its automatic build, then verify source/version, health counts, public navigation and authenticated admin/image behavior. Keep PR14 unmerged and Hostinger/main available for rollback.

## Validation

Typecheck PASS; full lint PASS; Workers build PASS (296 public snapshot pages, 262 products, 821 existing R2 references); 33/33 Workers guards PASS. Full Vitest PASS: 113 files and 1,105 tests passed; 76 files and 846 tests skipped because TEST_DATABASE_URL was unset. This run took 293.42 seconds with two workers and process-only synthetic fixture scratch under C:/dev/productos-small-test-scratch-20261010. No test database was created or connected. The new automatic Git build still needs to succeed; local success is recorded separately.

## Remaining launch work

Provide real public enquiry contact; review production build/runtime origin, indexing/caching and canonical URLs; configure website Custom Domain/www redirect with rollback. Recovery-email sender/binding and inbox test remain separate. This is a catalog/enquiry D1 pilot: orders, checkout/payments, stock operations, imports/uploads and other unported admin routes remain blocked. Existing R2 photos are reused.

## Source references

- https://github.com/cloudflare/vinext (inline nextConfig support and standalone packaging)
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
