# Staging admin login and private password reset — 9 October 2026

The owner created the first staging account. A second create-owner attempt was correctly refused: no second account was created. Passwords are not read back or copied from production.

The reported error reference775227767 was not reproduced with an incorrect-password request: the hosted Worker returned its ordinary credential error, with no runtime exception. A separate isolated successful-login test did reproduce a dashboard error after the cookie was saved. The sales-trend SQL passed raw JavaScript Date objects to D1 without a column encoder. The staging build adapter now binds those dates with the existing UTC column encoder, preserving Paraguay day boundaries. Next.js/Hostinger source is unchanged.

## Reset the existing staging password privately

From PowerShell on this PC:

```powershell
cd C:/Projects/productos-workers-staging
pnpm workers:create-owner --reset-password
```

Enter the email used for the successful first account creation. Enter the new password twice, at least12characters. Password typing is hidden. This updates only that existing active staging owner, increments its session version and leaves its role/name/email unchanged. It cannot create another owner, alter a staff account or reset an inactive account. The explicit flag is required; running the creation command without it still refuses a second active owner. Production credentials and catalog/orders are untouched. No migration is required.

After `Staging owner password updated; old sessions revoked.`, open a fresh https://productos-workers-staging.marklundfaktura.workers.dev/admin/login page and use the new password. Ignore saved live-site autofill credentials; Hostinger and staging accounts are separate. Never paste a password, session cookie or token into chat.

## Verification boundaries

The successful-login/reset/logout/rate-limit tests use isolated local D1 with generated test credentials kept in memory; they do not reset the real staging owner. Check the dated owner report for exact counts and deployed version. The owner must still privately test the real account after resetting it. The original error reference is retained as owner-reported evidence, not matched to a captured hosted exception. Unsupported checkout/order/stock/import/upload/settings/integration/cron features remain outside this pilot.
## Verification before deploy

Isolated local Worker/D1:22 authentication checks PASS, covering the form, anonymous redirect, ordinary wrong-password error, successful login, dashboard/products/categories, malformed cookie, old-session revocation, old/new password after reset, logout and rate limiting after8failed attempts. The real owner account/password was not changed. Hosted wrong-password/nonexistent-email probes returned ordinary credential errors with no Worker exceptions. They do not validate the real owner's correct password. The original dashboard error was reproduced locally before the adapter fix, with the successful-login checks passing afterward.

Typecheck/lint/Vinext build PASS; full local suite1103PASS/846skip (no MySQL test database);21Worker regression checks PASS after private input handling was added. Normal terminal navigation/escape keys are ignored in hidden password input so they cannot silently become password characters. Evidence: E:/ai work/Artifacts/productos.new/2026-10-09/login-reset/LOCAL-AUTH-BEFORE.json and LOCAL-AUTH-CHECKS.json. Deployed version and source revision are recorded in the owner report after deployment.