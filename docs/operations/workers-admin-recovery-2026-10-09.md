# Workers admin recovery and launch handoff — 9 October 2026

## Current result

The owner confirms successful login to the isolated Workers admin. The login now has an accessible show/hide-password button and a recovery link on the Workers build. Hostinger gets only the visibility control if this branch is later merged: the recovery link is injected by the D1 adapter, so it never points to an unimplemented Hostinger route.

The Worker handles /admin/recuperar and /admin/restablecer. Email recovery requires an explicitly enabled native EMAIL binding, a verified sender and the correct HTTPS site URL. Without configuration, the page says recovery is unavailable and POST returns503. The private CLI reset remains usable: `pnpm workers:create-owner --reset-password`; it does not require redeploying after a password change.

## Security and data

Generated D1 migration0002 adds only workers_admin_password_resets. Do not run MySQL migrations, seeds, owner creation or db:push. Inspect the D1 migration ledger before applying this one new migration to the isolated staging database. No existing owner password is changed by installing this feature.

Links expire after15minutes and have32random bytes. D1 stores SHA-256 digests only. A newer link invalidates older links; session-version changes or account deactivation invalidate links. An atomic D1 batch changes the bcrypt12 password and increments session_version, revoking previous logins. Simultaneous attempts cannot consume the same link twice. Browser passwords require12characters including a letter and digit and at most72UTF-8bytes (bcrypt input limit). Login still accepts existing passwords without imposing new strength validation on authentication.

The raw token travels only in the email URL fragment and submitted form body, never the generated GET path/query. The reset page copies it to a hidden field and clears the fragment. GET does not consume links, protecting against mail scanners. Recovery responses have no-store/noindex, no-referrer and nonce-based CSP. Same-origin POST,4096-byte actual-body limit, shared D1 request/consume limits, generic known/unknown-account responses and safe fixed-code errors protect the flow. No secrets, passwords, tokens or provider response bodies should be logged. Email click tracking that rewrites fragment links must be checked in the final delivery test.

Request limits: five/IP/hour, three/email/hour; consume ten/IP/hour. Queueing uses waitUntil. Delivery failure deletes the undelivered token and logs ADMIN_PASSWORD_RESET_EMAIL_FAILED; unexpected queue failure logs ADMIN_PASSWORD_RESET_QUEUE_FAILED. A generic request acknowledgement is not proof of email delivery. Check provider delivery and actual inbox.

## Cloudflare owner step / activation

Available Cloudflare dashboard was signed out during implementation. Sender choice and provider verification are pending; no verified domain, delivery or inbox success has been claimed. Proposed sender: no-reply@productos.com.py, subject to owner choice.

1. In Cloudflare, Compute > Email Service > Email Sending > Onboard Domain, select productos.com.py. Review SPF/DKIM/bounce-MX/DMARC records and complete verification. Preserve existing inbound routing and R2 records. Do not replace an existing SPF/DMARC policy blindly. [Official onboarding](https://developers.cloudflare.com/email-service/get-started/send-emails/).
2. Once verification succeeds, add the native binding to wrangler.jsonc; restrict its sender. No API token/SMTP password is needed with this binding. [Official binding configuration](https://developers.cloudflare.com/email-service/configuration/send-bindings/).

```json
"send_email": [{"name":"EMAIL", "allowed_sender_addresses":["no-reply@productos.com.py"]}]
```

3. Add explicit runtime vars to wrangler.jsonc (sender is an example to replace with the verified choice):

ADMIN_PASSWORD_RESET_ENABLED

```text
true
```

ADMIN_PASSWORD_RESET_FROM

```text
no-reply@productos.com.py
```

NEXT_PUBLIC_SITE_URL must remain the exact staging HTTPS origin for staging; change to https://productos.com.py only with the reviewed production build. Reset links use this configured origin, never arbitrary Host headers.

4. Run pnpm typecheck, pnpm lint, pnpm test, pnpm test:workers-preview; build with pnpm build:vinext then deploy with pnpm deploy:vinext. Verify binding survives generated dist/server/wrangler.json. Apply only outstanding D1 migration0002 if not already recorded.
5. Request one email to the existing owner. Verify actual inbox delivery, fragment retention, new password login, old password rejection and previous-session rejection. The owner enters/submits the new password privately. Avoid account creation or unintended resets. Until this test, email recovery remains unverified.

## Remaining launch work

1. Verify authenticated product/category/supplier save-and-reload on staging. Login alone does not verify these writes.
2. Supply real business WhatsApp/public email and implement a working enquiry CTA. Current contact page has no usable contact links; do not substitute a personal admin email or invent business details.
3. Diagnose the Cloudflare Git Builds final substantive error. Direct CLI deployment works but Git-triggered deployment has been failing. Keep PR14 draft/unmerged until its reviewed acceptance is satisfied.
4. Prepare actual production URL/canonicals/sitemap, enable indexing only on the real origin, verify caching/privacy and reconcile latest catalog changes. Existing anonymous renderer returns private/no-store, so cache remains BYPASS; do not promise cache savings before measurements.
5. In a coordinated cutover, attach productos.com.py to the reviewed Worker via Custom Domain, handle www redirect, confirm TLS/home/categories/contact/admin/R2 images. Retain original Hostinger apex/www targets as the DNS rollback and keep the old app/database available. R2 is already shared and needs no reupload.

The current D1 scope is a catalog/enquiry pilot: orders, checkout/payments, stock mutations, imports/uploads, settings/integrations, user management and cron remain blocked. It is not a complete transactional ecommerce port. Those features need their own D1 implementation and acceptance before enabling them.

## Validation

Typecheck/lint/Vinext build PASS. Full Vitest suite:113files/1105tests passed,76files/846tests skipped without TEST_DATABASE_URL; no production MySQL was used. Ten recovery security cases and two login UI cases pass. Compiled disposable Worker:26checks pass, including the revoked-cookie login-loop correction. The initial local probe had a temp-script encoding mismatch; rerunning its UTF-8 source fixed the assertion without changing application responses. The remote D1 ledger listed only migration0002; it was applied successfully, and read-only counts remain1user/262products/821images/0resetlinks. See the task status report for final source commit and deployed version. Tests use in-memory SQLite/disposable local D1; no existing account is reset. Cloudflare $5 is a shared allowance rather than a hard budget ceiling; this feature does not establish a capacity benchmark.
## Follow-up public image build correction

Authenticated save of staging product1 succeeded and reload/SQL preserved its name, Hogar y cocina category, enquiry mode, visible price of69000PYG, published_at and private Dropi URL; five image rows remained. The first read-only verification query mistakenly requested p.published; D1 correctly rejected that nonexistent column (SQLITE_ERROR7500). The corrected query used published_at and succeeded; no schema repair or further data change was needed.

Browser hydration then exposed a real preview issue: the local CLI build had omitted NEXT_PUBLIC_IMAGENES_URL from its client bundle, making admin gallery images disappear after hydration despite server-side URLs. vite.config.ts now inlines only the two whitelisted public URL values from reviewed wrangler.vars or explicit build overrides, validates HTTPS/non-secret URL shape and fails early for missing/unsafe values. Secrets are never included in the define map. Two additional build-config tests and an emitted-client-bundle check pass. This is a Workers build fix; Next/Hostinger build behavior and R2 objects are unchanged. Final browser gallery acceptance and deployment revision are recorded in the task report.