import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function withDatabase<T>(work: (client: Client) => Promise<T>) {
  const connectionString = process.env.NUVORTIQ_E2E_DATABASE_URL;
  if (!connectionString || new URL(connectionString).pathname !== "/nuvortiq_browser") throw new Error("Expected isolated browser database.");
  const client = new Client({ connectionString });
  try { await client.connect(); return await work(client); } finally { await client.end(); }
}
const day = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
async function seedClinic() {
  await withDatabase(async (client) => {
    await client.query("INSERT INTO clinic_settings (id, name, timezone) VALUES (1, 'Patient Booking Clinic', 'Asia/Kolkata')");
    await client.query("INSERT INTO doctor_profile (id, name, min_lead_minutes) VALUES (1, 'Synthetic Doctor', 0)");
    for (let weekday = 0; weekday < 7; weekday++) await client.query("INSERT INTO weekly_hours (doctor_id, day, start_minute, end_minute) VALUES (1, $1, 540, 720)", [weekday]);
  });
}
async function counts() {
  return withDatabase(async (client) => (await client.query("SELECT (SELECT count(*)::int FROM appointments) AS appointments, (SELECT count(*)::int FROM reservations WHERE kind = 'appointment') AS reservations, (SELECT count(*)::int FROM booking_audit) AS audit, (SELECT count(*)::int FROM booking_requests) AS receipts")).rows[0]);
}
async function signIn(page: Page, email = "patient@example.test", destination = "/book") {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Email", { exact: true }).press("Enter");
  await expect(page.getByLabel("Code", { exact: true })).toBeFocused(); await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByLabel("Code", { exact: true }).press("Enter");
  await expect(page).toHaveURL(destination === "/book" ? /\/book$/ : /\/appointments$/);
}
async function showTimes(page: Page) {
  await page.getByLabel("Appointment date", { exact: true }).fill(day());
  await page.getByRole("button", { name: "Show times", exact: true }).click();
  await expect(page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true })).toBeVisible();
}
async function review(page: Page, name = "Synthetic Visitor") {
  await page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your details", exact: true })).toBeFocused();
  await page.getByLabel("Full name", { exact: true }).fill(name); await page.getByLabel("Phone number", { exact: true }).fill("+91 98765 43210");
  await page.getByRole("button", { name: "Review booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your appointment", exact: true })).toBeFocused();
}

test("mobile keyboard booking preserves the destination, registers a patient and confirms only after review", async ({ page }, testInfo) => {
  await seedClinic(); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/"); await page.getByRole("link", { name: "Book appointment", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)book$/);
  const email = `booking-${randomUUID()}@example.test`;
  await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Email", { exact: true }).press("Enter");
  await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByLabel("Code", { exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/book$/); await showTimes(page);
  const slot = page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true }); await slot.focus(); await slot.press("Enter");
  await expect(page.getByLabel("Verified email", { exact: true })).toHaveValue(email); await expect(page.getByLabel("Verified email", { exact: true })).toHaveAttribute("readonly", "");
  await page.getByLabel("Full name", { exact: true }).fill("Synthetic Mobile Visitor"); await page.getByLabel("Phone number", { exact: true }).fill("+91 98765 43210");
  await page.getByLabel("Phone number", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Review your appointment", exact: true })).toBeFocused();
  expect(await counts()).toEqual({ appointments: 0, reservations: 0, audit: 0, receipts: 0 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("dialog", { name: "Review your appointment", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mobile-booking-review.png") });
  const confirm = page.getByRole("button", { name: "Confirm booking", exact: true }); await confirm.focus(); await confirm.press("Enter");
  await expect(page.getByRole("heading", { name: "Appointment confirmed", exact: true })).toBeFocused();
  expect(await counts()).toEqual({ appointments: 1, reservations: 1, audit: 1, receipts: 1 });
  await expect(page.getByRole("region", { name: "Booking confirmation", exact: true })).toContainText("Asia/Kolkata");
  await page.screenshot({ path: testInfo.outputPath("mobile-booking-confirmed.png"), fullPage: true });
  await page.getByRole("link", { name: "View My appointments", exact: true }).click();
  await expect(page.getByRole("list", { name: "Upcoming appointments", exact: true }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Upcoming appointments", exact: true })).toContainText("9:00 AM");
  expect((await page.request.get("/book")).headers()["cache-control"]).toContain("no-store");
});

test("abandoning a selected slot or review creates no appointment and keeps the time free", async ({ page }, testInfo) => {
  await seedClinic(); await signIn(page); await showTimes(page);
  const slots = page.locator('[aria-label="Available times"]');
  expect((await slots.boundingBox())!.width).toBeGreaterThan(900);
  await expect(page.locator("main")).not.toContainText("Bookings open through");
  await page.screenshot({ path: testInfo.outputPath("desktop-booking-slots.png"), fullPage: true });
  await review(page);
  await page.screenshot({ path: testInfo.outputPath("desktop-booking-review.png") });
  await page.getByRole("button", { name: "Close review", exact: true }).click();
  await page.getByRole("link", { name: "My appointments", exact: true }).click(); await expect(page.getByRole("heading", { name: "No appointments yet", exact: true })).toBeVisible();
  expect(await counts()).toEqual({ appointments: 0, reservations: 0, audit: 0, receipts: 0 });
  await page.getByRole("link", { name: "Book an appointment", exact: true }).click(); await showTimes(page);
  await expect(page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true })).toBeVisible();
});

test("a stale slot refreshes choices, retains details and needs an explicit new selection", async ({ page }) => {
  await seedClinic(); await signIn(page); await showTimes(page); await review(page);
  const { availability } = await (await page.request.get(`/api/patient/availability?date=${day()}`)).json();
  const stale = availability.slots[0];
  await withDatabase(async (client) => { await client.query("INSERT INTO reservations (doctor_id, kind, starts_at, ends_at, reason) VALUES (1, 'block', $1, $2, 'private break')", [stale.startsAt, stale.endsAt]); });
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("no longer available");
  await expect(page.locator("main").getByRole("alert")).toBeFocused();
  await expect(page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm booking", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "9:20 AM – 9:40 AM", exact: true }).click();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Synthetic Visitor"); await expect(page.getByLabel("Phone number", { exact: true })).toHaveValue("+919876543210");
  expect((await counts()).appointments).toBe(0);
  await page.getByRole("button", { name: "Review booking", exact: true }).click(); await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed", exact: true })).toBeVisible(); expect((await counts()).appointments).toBe(1);
});

test("a lost response retries the exact committed request and prevents duplicate confirmation", async ({ page }) => {
  await seedClinic(); await signIn(page); await showTimes(page); await review(page);
  const bodies: string[] = []; let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/patient/bookings", async (route) => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) { await route.fetch(); await gate; await route.abort("failed"); }
    else if (bodies.length === 2) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "BOOKING_NOT_READY", error: "Online booking is temporarily unavailable." }) });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirming…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Review your appointment", exact: true })).toBeVisible();
  release(); await expect(page.getByRole("button", { name: "Retry confirmation", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog", { name: "Review your appointment", exact: true })).toBeVisible();
  await expect(page.getByLabel("Appointment date", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry confirmation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry confirmation", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry confirmation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed", exact: true })).toBeVisible();
  expect(bodies).toHaveLength(3); expect(bodies[0]).toBe(bodies[1]); expect(bodies[1]).toBe(bodies[2]);
  expect(await counts()).toEqual({ appointments: 1, reservations: 1, audit: 1, receipts: 1 });
});

test("competing patients cannot both confirm the same visible slot", async ({ page, browser }) => {
  await seedClinic(); await signIn(page); await showTimes(page); await review(page);
  const otherContext = await browser.newContext({ baseURL: process.env.NUVORTIQ_E2E_URL, extraHTTPHeaders: { "x-forwarded-for": "192.0.2.251" } });
  try {
    const other = await otherContext.newPage(); await signIn(other, "other@example.test"); await showTimes(other); await review(other, "Other Synthetic Visitor");
    const responses = await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/patient/bookings")), other.waitForResponse((response) => response.url().endsWith("/api/patient/bookings")), page.getByRole("button", { name: "Confirm booking", exact: true }).click(), other.getByRole("button", { name: "Confirm booking", exact: true }).click()]);
    expect([responses[0].status(), responses[1].status()].sort()).toEqual([200, 409]);
    const winner = responses[0].status() === 200 ? page : other, loser = winner === page ? other : page;
    await expect(winner.getByRole("heading", { name: "Appointment confirmed", exact: true })).toBeVisible();
    await expect(loser.locator("main").getByRole("alert")).toContainText("no longer available");
    expect(await counts()).toEqual({ appointments: 1, reservations: 1, audit: 1, receipts: 1 });
  } finally { await otherContext.close(); }
});

test("failed availability reads preserve the requested date and can be retried", async ({ page }) => {
  await seedClinic(); await signIn(page);
  await page.route("**/api/patient/availability?**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Times are temporarily unavailable. Please try again." }) }));
  await page.getByLabel("Appointment date", { exact: true }).fill(day()); await page.getByRole("button", { name: "Show times", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("temporarily unavailable"); await expect(page.getByLabel("Appointment date", { exact: true })).toHaveValue(day());
  await page.unroute("**/api/patient/availability?**"); await showTimes(page);
});

test("unconfigured clinics and closed dates show useful empty states", async ({ page }) => {
  await signIn(page); await expect(page.getByRole("heading", { name: "Online booking is not available yet", exact: true })).toBeVisible();
  await seedClinic(); await withDatabase(async (client) => { await client.query("INSERT INTO day_overrides (doctor_id, date, mode, reason) VALUES (1, $1, 'closed', 'internal holiday note')", [day()]); });
  await page.reload(); await page.getByLabel("Appointment date", { exact: true }).fill(day()); await page.getByRole("button", { name: "Show times", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("The clinic is closed on this date"); await expect(page.locator("main")).not.toContainText("internal holiday note");
});

test("review modal contains focus and closes without losing details or reserving time", async ({ page }) => {
  await seedClinic(); await signIn(page); await showTimes(page); await review(page);
  const dialog = page.getByRole("dialog", { name: "Review your appointment", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Shift+Tab"); await expect(dialog.getByRole("button", { name: "Edit details", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(dialog.getByRole("button", { name: "Close review", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Review booking", exact: true })).toBeFocused();
  await expect(page.getByLabel("Full name", { exact: true })).toHaveValue("Synthetic Visitor");
  await page.getByRole("button", { name: "Review booking", exact: true }).click();
  await dialog.getByRole("button", { name: "Edit details", exact: true }).click(); await expect(dialog).not.toBeVisible();
  expect(await counts()).toEqual({ appointments: 0, reservations: 0, audit: 0, receipts: 0 });
});

test("a definite setup failure keeps the review editable and can recover without an uncertain-result warning", async ({ page }) => {
  await seedClinic(); await signIn(page); await showTimes(page); await review(page);
  await page.route("**/api/patient/bookings", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "BOOKING_NOT_READY", error: "Online booking is temporarily unavailable. Please try again or contact the clinic." }) }));
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review your appointment", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("Online booking is temporarily unavailable");
  await expect(dialog.getByRole("button", { name: "Edit details", exact: true })).toBeEnabled();
  await expect(dialog).not.toContainText("Confirmation couldn’t be checked");
  expect((await counts()).appointments).toBe(0);
  await page.unroute("**/api/patient/bookings"); await dialog.getByRole("button", { name: "Confirm booking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Appointment confirmed", exact: true })).toBeVisible(); expect((await counts()).appointments).toBe(1);
});

test("invalid details can be corrected, while an expired session requires sign-in before saving", async ({ page }) => {
  await seedClinic(); await signIn(page); await showTimes(page); await page.getByRole("button", { name: "9:00 AM – 9:20 AM", exact: true }).click();
  await page.getByRole("button", { name: "Review booking", exact: true }).click(); await expect(page.locator("main").getByRole("alert")).toContainText("Enter your name");
  await page.getByLabel("Full name", { exact: true }).fill("Synthetic Visitor"); await page.getByLabel("Phone number", { exact: true }).fill("1234567890"); await page.getByRole("button", { name: "Review booking", exact: true }).click();
  await withDatabase(async (client) => { await client.query("DELETE FROM patient_auth.session WHERE user_id = (SELECT id FROM patient_auth.\"user\" WHERE email = 'patient@example.test')"); });
  await page.getByRole("button", { name: "Confirm booking", exact: true }).click(); await expect(page.getByRole("link", { name: "Sign in again to book", exact: true })).toHaveAttribute("href", "/login?next=/book");
  expect((await counts()).appointments).toBe(0);
});

test("sign-in ignores external destinations and clinic sessions cannot open booking", async ({ page }) => {
  await seedClinic(); await signIn(page, "patient@example.test", "https://untrusted.example/");
  await page.goto("/admin"); await page.getByLabel("Email", { exact: true }).fill("doctor@example.test"); await page.getByLabel("PIN", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/admin\/workspace$/);
  await page.goto("/appointments"); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/patient/availability")).status()).toBe(401);
  await page.goto("/book"); await expect(page).toHaveURL(/\/login\?next=(%2F|\/)book$/);
  expect((await page.request.get("/api/patient/availability")).status()).toBe(401);
});

test("admin can copy the configured hosted link and website button", async ({ page, context }, testInfo) => {
  await seedClinic(); await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/admin"); await page.getByLabel("Email", { exact: true }).fill("doctor@example.test"); await page.getByLabel("PIN", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/admin\/workspace$/);
  const url = `${process.env.NUVORTIQ_E2E_URL}/book`;
  await expect(page.getByLabel("Hosted booking URL", { exact: true })).toHaveValue(url);
  await page.getByRole("button", { name: "Copy link", exact: true }).click(); await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.getByRole("button", { name: "Copy website button", exact: true }).click(); await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`<a href="${url}">Book appointment</a>`);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-booking-link.png"), fullPage: true });
});
