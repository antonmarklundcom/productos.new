# Fable: status of ecom + productos.new → a plan Opus 5.5 can run today

Paste everything below the line into a **Fable** session that Anton opens himself, locally.

---

You are Fable, in a session Anton opened himself. Your job today is to **analyze, not build**:
look at two repos end to end, tell Anton the honest status, and leave a plan that **Opus 5.5**
sessions can start executing today without you. Implement nothing except trivial fixes
(a typo, a broken script line, under 5 minutes).

Load the skills `fable-cost-guardrail`, `phased-autonomous-build`, `nextjs-deploy-hostinger`,
`nodejs-mysql-hostinger-stack` and `budgeted-runner-deploy` before you start. Never spawn a
subagent, session or workflow on Fable; use Sonnet or Haiku Explore agents for fan-out reading.
Fable is never named as the executor of anything you write.

## The goal (Anton's words, condensed)

`antonmarklundcom/ecom` is meant to be **the template I copy for hundreds of stores**. Before
copying it more, I want to improve it. The runtime is decided: **Next.js on Node.js at
Hostinger** (Brazil data center, 3-year prepaid plan) with MySQL. Cloudflare stays for
**DNS, R2 and Email Routing**, and I may still use **D1**. I considered Cloudflare + Astro and
dropped it. `antonmarklundcom/productos.new` (productos.com.py) is a store made from the
template that drifted into Cloudflare Workers + D1 + R2.

## Step 0: get both repos

Clone both side by side if they are not already there (use `gh`/git with Anton's own login):
- `antonmarklundcom/ecom` (the template; default branch `main`)
- `antonmarklundcom/productos.new` (the live store)

Read in each: `CLAUDE.md`, `AGENTS.md`, `README.md`, `PLAN.md`, `TASKS.md`, `ARCH.md`,
`DEPLOY.md`, `KNOWN-ISSUES.md`, `package.json`, `.github/workflows/`, and the last ~50
commits. In ecom also read `fable/PROMPT.md`, the latest `fable/REVIEW*.md`,
`fable/TEMPLATE-REVIEW.md`, `docs/TEMPLATE-IMPROVEMENT-PLAN.md` and `tiendas.json`. Obey each
repo's rules, especially the machinery-vs-skin table in `CLAUDE.md`.

## What is already known (verify, don't trust)

Checked by a Claude session on 2026-11-10, read-only. Confirm each point yourself.

**ecom: 9 open PRs, all built from the same `main` commit (`91111ca`), none merged:**
#158 hosting decision record (`docs/decisions/0001-hosting.md`: Hostinger Node + MySQL only,
Cloudflare DNS-only + R2 + Email Routing, Workers/D1 never enter the template) ·
#159 Renovate + cheap CI · #160 tolerant Pagopar webhook · #161 single instance on
`pnpm start` + graceful shutdown · #162 supplier model + featured order ·
#163 theme kit · #164 SEO/ISR/JSON-LD/Lighthouse · #165 R2 replaces Cloudinary ·
#166 batch catalog import (**already contains #162 and #165**).
- A test merge in the order 158 → 160 → 161 → 159 → 166 → 164 → 163 hit `CHANGELOG.md` in
  every PR (union merge is fine), plus three conflicts that need judgment:
  #163 vs #164 in `src/app/page.tsx` (actual code), `NEW-STORE.md`, `scripts/template-sync.ts`;
  #166 vs #164 in `ARCH.md`, `KNOWN-ISSUES.md`, `TASKS.md`; #161 vs #160 in `NEW-STORE.md`.
- CI status and test results for each PR were **not** checked. Do that.

**productos.new vs ecom:**
- Live productos.com.py has been served by a Worker since 2026-10-10 (vinext build, D1 database
  `productos-workers-staging`, R2 bucket `productos-images`). The Hostinger Next.js build is
  still in the repo as rollback (`rollback-hostinger*` DNS records).
- The Workers build only covers catalog, WhatsApp inquiries and product/category admin.
  Checkout, orders, payments, stock changes, imports, uploads, settings and cron are blocked.
- Drift: about 170 files differ, 133 exist only in productos.new, 79 only in ecom.
- **Migration numbers collide:** both repos have `0023_*` and `0024_*` in `drizzle/` with
  different contents; productos.new continues to `0026`.
- ecom's `tiendas.json` points at `antonmarklundcom/productos`, **not** `productos.new`
  (last sync 2026-09-24), so automatic template updates don't reach the live store.
- `productos.new/PLAN.md` and `README.md` still say "Hostinger, no Cloudflare", which no longer
  matches what is live.

## Step 1: status of ecom

1. For every open PR: CI result, whether it is behind `main`, real test results
   (`pnpm typecheck && pnpm lint && pnpm test`, plus the MySQL integration suite with a real
   MySQL 8 started locally or in Docker, not skipped), and whether the description matches
   the diff.
2. Confirm or correct the merge order and the conflict list above. For each conflict, say
   how it should be resolved.
3. Say per PR: **merge as is / fix then merge / split / close**, with the reason.

## Step 2: productos.new

1. What runs where today, and what an owner can and cannot do on the live site.
2. List what productos.new has that the template should get back: supplier model, R2 photo
   pipeline, catalog work from the 2026-11-06 batch, security fixes, and so on. Mark what
   #162/#165/#166 already cover and what is still missing.
3. A path for moving productos.com.py back onto the template on Hostinger when it needs
   checkout: data move D1 → MySQL, R2 kept as is, DNS switch, migration-number clash, how it
   rejoins `tiendas.json` and `template:sync`, and the rollback. Plan it only; change no DNS
   or production data.

## Step 3: is the template ready for hundreds of stores?

Answer with evidence and say where you are guessing:
- **Hostinger limits:** Node apps per plan, MySQL databases per plan, the shared process
  ceiling (productos.new logged about 200 processes and 429s when redeploys left orphans),
  RAM/CPU per app, and the Brazil data center's latency from Paraguay. Read Hostinger's
  current docs; don't use remembered numbers. If one plan holds only N stores, say so.
- **D1 from Node:** D1 is reachable from Node only through Cloudflare's HTTP API, and the
  money logic depends on MySQL row locks (`SELECT … FOR UPDATE`, ARCH.md). Say where D1 could
  still help (for example read-only catalog snapshots, analytics) and where it must not go.
- **Distribution:** can `distribuir.yml` + `template:sync` + `tiendas.json` handle 100+ stores
  (time, conflicts, GitHub Actions minutes within about 2,000–3,000 minutes per month,
  rate limits)? What breaks first?
- **New-store time:** how long `pnpm nueva-tienda` → live store takes today, and the top
  three things that would cut it.
- **Cost per store per month** across Hostinger, R2, CI and email.

## Step 4: write it down (in ecom, under `fable/`)

On a new branch `fable/review-2026-11-10` in ecom:
1. `fable/REVIEW-2026-11-10.md`: a verdict in at most 6 lines; per-PR table; the productos.new
   section; the hundreds-of-stores section; findings table (id, severity, area, file:line,
   problem, fix sketch); what is good and must not be "improved" away; **open questions for
   Anton, each with a recommended answer**.
2. `fable/plan-2026-11.md`: phases in the `phased-autonomous-build` structure, adapted to an
   existing repo. **Phase 1 must be doable by Opus 5.5 today:** get the 9 PRs merged in
   order with conflicts resolved and the full suite green. Then the next phases by priority.
   One phase = one PR = one session. The phase table goes in the header.
3. `fable/prompts/opus-<n>-<slug>.md` per phase, at most 30 lines each, with checkable exit
   criteria and a handoff footer (Opus/Sonnet only, never Fable). Mark phases that are safe
   for Sonnet.
4. If something belongs in productos.new (e.g. fixing PLAN/README, adding it to
   `tiendas.json`), plan it there as its own phase. Don't edit productos.new today.

Don't duplicate the older plans in `fable/`; say what yours replaces.

## Hard rules

- No merges, no pushes to `main`, no PRs unless Anton says so. Push only your review branch.
- No changes to production: no DNS, Hostinger, Cloudflare, D1, R2 or live data.
- No invented credentials, prices or limits. Mark anything unverified as unverified.
- Confirmed findings only, with file:line. Skip anything the repo's docs explain as deliberate.

## Closing report to Anton (in chat, short, plain language)

1. Status in 5 lines: ecom, productos.new, and whether Hostinger Node fits hundreds of stores.
2. The decisions Anton has to make, with your recommendation for each.
3. The exact first prompt file to give Opus 5.5 today.
4. Branch and commit of your review.
