# Testing the current M1 foundation

**The home page is a preview. Login and booking screens are not implemented yet.** Its **What to expect** button scrolls to feature descriptions. There is currently no working Sign in or Book appointment action. `/admin`, `/login` and `/book` are planned routes, so a 404 there is expected at this stage.

## 1. Browser checks

Keep your existing dev server running and open `http://localhost:3000`.

- Confirm the page title, heading and “Clinic setup in progress” badge appear.
- Click **What to expect**: it should scroll to the three feature cards.
- Use Tab and Enter to reach/activate the link; check that focus is visible.
- Check desktop and mobile widths for overlapping text or horizontal scrolling.

These checks cover the foundation page only. They do not test authentication or bookings.

## 2. Automated checks

In another terminal, from the project directory:

```sh
npx --yes pnpm@12.18.0 check
npx --yes pnpm@12.18.0 test:integration
```

Expected results:

| Command | Expected result |
| --- | --- |
| `check` | Clean lint/typecheck and **12 passing unit tests**. |
| `test:integration` | **17 passing tests** against a disposable real PostgreSQL database. |

Integration tests start/stop their own database and create synthetic users. You do not need to start the development database, configure real email or bootstrap an admin first. They check staff codes, admin PIN/reset/lockout, patient/staff separation, migration upgrades and localhost-only `0000`. **Staff PIN attempts must fail**, including in test mode.

## 3. Production build check

When ready, stop the dev server with Ctrl+C before building; dev and build both use `.next`.

```sh
npx --yes pnpm@12.18.0 build
npx --yes pnpm@12.18.0 start
```

Expect a successful build and the same preview at `http://localhost:3000`. Stop `start` before returning to `dev`. This checks a local production build; it does not deploy anything.

## 4. Optional: development database and admin bootstrap

This checks setup only, not browser login.

1. Start `npx --yes pnpm@12.18.0 db:local` in a separate terminal. If Docker already runs the database on port 54329, use that instead.
2. Create `.env.local` from `.env.example` **only if it does not already exist**. Configure separate auth secrets and a synthetic admin email/name/PIN; see [README](../README.md#local-postgresql).
3. Run:

```sh
npx --yes pnpm@12.18.0 db:migrate
npx --yes pnpm@12.18.0 db:bootstrap-admin
```

Expect “Admin created” initially; a repeat reports “Admin already exists; PIN unchanged.” Keep credentials private. `AUTH_TEST_MODE=true` does not create a login screen or staff accounts; `0000` is exercised by the automated tests today.

## Next milestone

M2 adds `/admin` and its two-step Email/PIN → Send code → Code form, staff management and PIN-change screens. Patient booking comes later. Browser login, appointment allocation, Calendar sync and real notifications cannot be manually tested in the current build.
