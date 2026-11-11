# Testing the current MVP

**Available:** clinic sign-in/workspace, patient sign-in at `/login`, and a protected patient list at `/appointments`. `/book` supports patient booking. Staff management and PIN-change screens are still pending.

**Clinic settings:** After `pnpm db:migrate`, sign in as admin → **Clinic settings**. Enter names, choose a timezone, set appointment rules and add weekly hours. Save and reload to verify persistence. Overlapping/reversed hours must be rejected; removing all intervals closes a day. Staff cannot open this page or change settings.

**Availability:** Admin → **Availability** → choose a future date → **Show day**. Mark **Holiday / Closed**, apply and reload: no slots. Restore **Use weekly hours**: slots return. Try **Special hours** and a one-off break: only that date changes, and blocked times disappear from the preview. Restoring weekly hours keeps breaks until removed. Overlapping breaks/hours must be rejected. Previewing never books a slot.

**Doctor calendar:** Admin → **Calendar**. Switch Day/Week, choose dates, navigate and refresh. Available slots are green, booked times red and breaks amber; each also has a text label. Add a break in Availability and refresh Calendar to check it. Booked cards use appointment reservations, including confirmed patient bookings. Viewing creates no reservation.

## 1. Local setup

Keep your existing dev server running. Start local PostgreSQL if needed, then use your ignored `.env.local` settings:

- Set `AUTH_TEST_MODE=true` for localhost development only. Keep separate patient/staff auth secrets.
- Set a dedicated `BOOKING_DATA_KEY` with `openssl rand -base64 32` if absent; retain an existing key unchanged.
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

Unknown/admin emails receive the same code-request feedback as staff but cannot use staff code login. Real email is not sent in test mode; email-provider setup is a later task. New patients are registered automatically after code verification. Local test mode uses a requested `0000`; normal mode requires the delivered email code; staff creation is still pending.

**Patient checks:**

- With `AUTH_TEST_MODE=true`, open `/login`, enter a new synthetic email such as `patient@example.test`, request a code and enter `0000`. No account setup or separate signup is needed; entering an email alone creates no account.
- Expect **My appointments** and **No appointments yet** for this new account. Choose **Book an appointment**, load an available date, select a time and enter a synthetic name/phone. Review, then **Confirm booking**; expect confirmation and the visit in My appointments. Leaving before confirmation creates no booking.
- In My appointments, choose **Cancel appointment** for a future confirmed visit. Keep appointment/Escape closes without saving; confirming moves it to history as Cancelled and frees its buffered time. Started/past visits cannot be cancelled. No cancellation email is sent in this slice.
- Sign out and revisit `/appointments`: it should return to `/login`. Patient sign-in must not open the clinic workspace, and clinic sign-in alone must not open patient appointments.
- Try an incorrect/expired code, request a new code, and change the email. Errors should be clear; repeated attempts remain limited. With test mode off, code requests report unavailable until email delivery is connected.

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
