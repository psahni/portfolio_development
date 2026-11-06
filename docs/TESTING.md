# Testing the current MVP

**Available:** shared `/admin` login, protected `/admin/workspace` and sign out. Booking, staff management and PIN-change screens are still pending.

## 1. Local setup

Keep your existing dev server running. Start local PostgreSQL if needed, then use your ignored `.env.local` settings:

- Set `AUTH_TEST_MODE=true` for localhost development only. Keep separate patient/staff auth secrets.
- Configure a synthetic bootstrap admin email/name and four-digit PIN other than `0000`.
- Run `pnpm db:migrate` and `pnpm db:bootstrap-admin`. Repeating bootstrap preserves the existing PIN.

See [README](../README.md#local-postgresql) for setup commands. Use `npx --yes pnpm@12.18.0` instead of `pnpm` if the pinned version is not installed.

## 2. Browser checks

Open `http://localhost:3000` and choose **Clinic sign in**.

| Check | Expected result |
| --- | --- |
| Initial `/admin` screen | Email and PIN inputs, Send code below PIN, and Sign in. |
| Admin email + configured PIN | Opens the clinic workspace as Doctor / Admin. Local test mode also accepts `0000`. |
| Staff email + PIN | Rejected, including `0000`. |
| Staff email → Send code, leaving PIN blank | Replaces both inputs with one Code input; retains email and clears PIN. |
| Enter `0000` after requesting a staff code | Opens the workspace as Staff in localhost test mode. The staff account must already exist and be active. |
| Use another email | Returns to Email/PIN with credentials cleared and email available to edit. |
| Sign out, then visit `/admin/workspace` | Returns to `/admin`. |

Unknown/admin emails receive the same code-request feedback as staff but cannot use staff code login. Real email is not sent in test mode; email-provider setup is a later task. There is no public signup or staff-creation screen yet.

Check keyboard navigation, visible focus and mobile widths for overlap or horizontal scrolling. During requests, controls should be disabled; failures should show a retryable error.

## 3. Automated checks

```sh
pnpm check
pnpm test:integration
pnpm exec playwright install chromium # once
pnpm test:e2e
```

Integration/browser tests create synthetic accounts in disposable PostgreSQL. Browser tests start their own temporary Next.js source copy; they do not use your development database or send email. CI runs these checks too.

For a production build check, stop your dev server first because dev/build share `.next`, then run `pnpm build` and `pnpm start`. Test mode is rejected in production; validate `0000` only with `pnpm dev`.
