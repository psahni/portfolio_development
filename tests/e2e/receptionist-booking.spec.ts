import type { Page } from "@playwright/test";
import { Client } from "pg";
import { test, expect } from "./fixtures";

async function withDatabase<T>(work: (db: Client) => Promise<T>) {
  const connectionString = process.env.NUVORTIQ_E2E_DATABASE_URL;
  if (!connectionString || new URL(connectionString).pathname !== "/nuvortiq_browser") throw new Error("Expected isolated browser database.");
  const db = new Client({ connectionString });
  try { await db.connect(); return await work(db); } finally { await db.end(); }
}
const day = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
async function seedClinic() {
  await withDatabase(async (db) => {
    await db.query("INSERT INTO clinic_settings (id, name, timezone) VALUES (1, 'Reception Booking Clinic', 'Asia/Kolkata')");
    await db.query("INSERT INTO doctor_profile (id, name, min_lead_minutes) VALUES (1, 'Synthetic Doctor', 0)");
    for (let weekday = 0; weekday < 7; weekday++) await db.query("INSERT INTO weekly_hours (doctor_id, day, start_minute, end_minute) VALUES (1, $1, 540, 720)", [weekday]);
  });
}
async function login(page: Page, admin = false) {
  await page.goto("/admin"); await page.getByLabel("Email", { exact: true }).fill(admin ? "doctor@example.test" : "staff@example.test");
  if (admin) await page.getByLabel("PIN", { exact: true }).fill("4821");
  else { await page.getByRole("button", { name: "Send code" }).click(); await page.getByLabel("Code", { exact: true }).fill("0000"); }
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/admin\/workspace$/);
  await page.getByRole("link", { name: "Book appointment navigation" }).click();
  await expect(page).toHaveURL(/\/admin\/book$/);
  await expect(page.getByRole("heading", { name: "Book an appointment", exact: true })).toBeVisible();
}
async function choose(page: Page) {
  await page.getByLabel("Appointment date", { exact: true }).fill(day());
  await page.getByRole("button", { name: "Show times", exact: true }).click();
  await page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Patient details", exact: true })).toBeFocused();
}
async function review(page: Page) {
  await page.getByLabel("Patient name", { exact: true }).fill("Reception Visitor");
  await page.getByLabel("Patient email", { exact: true }).fill("patient@example.test");
  await page.getByLabel("Patient phone", { exact: true }).fill("+91 98765 43210");
  await page.getByRole("button", { name: "Review booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review appointment", exact: true })).toBeFocused();
}
async function count() { return withDatabase(async (db) => (await db.query("SELECT count(*)::int AS count FROM appointments")).rows[0].count as number); }

test("mobile receptionist books, cancels with a reason and switches dated status tabs without patient auto-linking", async ({ page }, testInfo) => {
  await seedClinic(); await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  for (const name of ["Staff navigation", "Clinic settings navigation", "Availability navigation", "Calendar navigation"]) await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  await choose(page); await page.getByRole("button", { name: "Review booking", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("valid email");
  await review(page); expect(await count()).toBe(0);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  await expect(page.getByLabel("Patient email", { exact: true })).toHaveValue("patient@example.test");
  await page.getByRole("button", { name: "Review booking", exact: true }).click();
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed" })).toBeVisible(); expect(await count()).toBe(1);
  await page.getByRole("link", { name: "View daily agenda" }).click();
  await expect(page.getByRole("heading", { name: "Reception Visitor" })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Confirmed (1)", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this appointment?", exact: true });
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(dialog.getByLabel("Rebooking instruction (optional)", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  expect(await withDatabase(async (db) => (await db.query("SELECT status FROM appointments")).rows[0].status)).toBe("confirmed");
  await dialog.getByLabel("Cancellation reason", { exact: true }).fill("Patient requested cancellation");
  await dialog.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("No confirmed appointments for this date.", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Cancelled (1)", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`date=${day()}&status=cancelled`));
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Cancellation reason: Patient requested cancellation");
  await page.screenshot({ path: testInfo.outputPath("mobile-staff-cancelled-tab.png") });
  await page.getByRole("button", { name: "Refresh appointments", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Cancelled (1)", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByRole("tab", { name: "Cancelled (1)", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Appointment date", { exact: true }).fill("2020-01-01");
  await page.getByRole("button", { name: "Show appointments", exact: true }).click();
  await expect(page).toHaveURL(/date=2020-01-01.*status=cancelled|status=cancelled.*date=2020-01-01/);
  await expect(page.getByRole("tab", { name: "Cancelled (0)", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tablist", { name: "Appointment status", exact: true })).toHaveAttribute("aria-busy", "false");
  await page.getByRole("tab", { name: "Cancelled (0)", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Confirmed (0)", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Appointment date", { exact: true }).fill(day());
  await page.getByRole("button", { name: "Show appointments", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await withDatabase(async (db) => {
    const { rows } = await db.query("SELECT source, patient_user_id, created_by_staff_id FROM appointments");
    expect(rows[0]).toMatchObject({ source: "clinic", patient_user_id: null }); expect(rows[0].created_by_staff_id).toBeTruthy();
    expect((await db.query("SELECT count(*)::int AS count FROM whatsapp_notifications")).rows[0].count).toBe(0);
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("patient@example.test");
  await page.getByRole("button", { name: "Send code" }).click(); await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/); await expect(page.getByText("Reception Visitor", { exact: true })).toHaveCount(0);
});

test("lost committed response preserves the exact request and retry returns one booking", async ({ page }) => {
  await seedClinic(); await login(page); await choose(page); await review(page);
  const payloads: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/bookings", async (route) => {
    payloads.push(route.request().postData()!);
    if (payloads.length === 1) { await route.fetch(); await gate; await route.abort("failed"); }
    else await route.continue();
  });
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirming…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Show times", exact: true })).toBeDisabled();
  release(); await expect(page.getByRole("button", { name: "Retry confirmation", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Discard selection", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry confirmation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed" })).toBeVisible();
  expect(payloads).toHaveLength(2); expect(payloads[0]).toBe(payloads[1]); expect(await count()).toBe(1);
});

test("slot conflicts refresh availability and discarding a selection creates nothing", async ({ page }) => {
  await seedClinic(); await login(page, true); await choose(page); await review(page);
  await page.route("**/api/admin/bookings", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "SLOT_UNAVAILABLE", error: "That slot is no longer available." }) }));
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("That slot is no longer available.");
  await expect(page.getByRole("heading", { name: "Review appointment", exact: true })).toHaveCount(0); expect(await count()).toBe(0);
  await page.unroute("**/api/admin/bookings"); await choose(page);
  await page.getByRole("button", { name: "Discard selection", exact: true }).click(); expect(await count()).toBe(0);
  await page.reload(); await choose(page); await review(page); await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed" })).toBeVisible();
  await page.getByRole("link", { name: "View daily agenda" }).click();
  await expect(page.getByRole("heading", { name: "Reception Visitor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toBeVisible();
});

test("booking denies anonymous and patient access, and staff see closed dates without admin setup links", async ({ page }) => {
  await page.goto("/admin/book"); await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/booking-availability")).status()).toBe(401);
  await seedClinic();
  await withDatabase(async (db) => { await db.query("DELETE FROM weekly_hours"); });
  await login(page); await expect(page.getByRole("status")).toContainText("No appointments are available");
  await page.getByLabel("Appointment date", { exact: true }).fill(day()); await page.getByRole("button", { name: "Show times", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The clinic is closed");
  await withDatabase(async (db) => { await db.query("DELETE FROM clinic_settings"); });
  await page.reload(); await expect(page.getByRole("heading", { name: "Set up your clinic first" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clinic settings", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("patient@example.test");
  await page.getByRole("button", { name: "Send code" }).click(); await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/); await page.goto("/admin/book"); await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/booking-availability")).status()).toBe(401);
});

test("confirmation and agenda use the committed timezone after settings change during review", async ({ page }) => {
  await seedClinic(); await login(page); await choose(page); await review(page);
  // The chosen instant is 03:30 UTC. Keep it bookable after moving the clinic
  // to UTC, so the receipt must show saved settings rather than the old preview.
  await withDatabase(async (db) => {
    await db.query("UPDATE clinic_settings SET timezone='UTC' WHERE id=1");
    await db.query("UPDATE weekly_hours SET start_minute=210, end_minute=390");
  });
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  const confirmation = page.getByRole("region", { name: "Booking confirmation" });
  await expect(confirmation).toContainText("3:30 AM – 3:50 AM (UTC)");
  await page.getByRole("link", { name: "View daily agenda" }).click();
  await expect(page.getByLabel("Appointment date", { exact: true })).toHaveValue(day());
  await expect(page.getByRole("heading", { name: "Reception Visitor" })).toBeVisible();
  await expect(page.getByText("Clinic timezone: UTC.", { exact: false })).toBeVisible();
});


test("staff cancels an admin-created visit with exact retry after a lost response", async ({ page }) => {
  await seedClinic(); await login(page, true); await choose(page); await review(page);
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page);
  await page.goto(`/admin/appointments?date=${day()}`);
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this appointment?", exact: true });
  await dialog.getByLabel("Cancellation reason", { exact: true }).fill("Patient called the clinic");
  const bodies: string[] = [];
  await page.route("**/api/admin/appointments", async (route) => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) { await route.fetch(); await route.abort("failed"); }
    else await route.continue();
  });
  await dialog.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Cancellation could not be checked");
  await expect(dialog.getByLabel("Cancellation reason", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Retry cancellation", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("tab", { name: "Cancelled (1)", exact: true }).click();
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Cancellation reason: Patient called the clinic");
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
  await withDatabase(async (db) => {
    expect((await db.query("SELECT count(*)::int AS count FROM booking_audit WHERE action='cancelled'")).rows[0].count).toBe(1);
    expect((await db.query("SELECT count(*)::int AS count FROM reservations")).rows[0].count).toBe(0);
  });
});
