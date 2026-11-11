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
test.beforeEach(async ({ page }) => { page.on("pageerror", (error) => console.error("Doctor appointments client error:", error.message)); });
async function signIn(page: Page, staff = false) {
  await page.goto("/admin"); await page.getByLabel("Email", { exact: true }).fill(staff ? "staff@example.test" : "doctor@example.test");
  if (staff) { await page.getByRole("button", { name: "Send code", exact: true }).click(); await page.getByLabel("Code", { exact: true }).fill("0000"); }
  else await page.getByLabel("PIN", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/admin\/workspace$/);
}
async function setup(page: Page) {
  await withDatabase(async (db) => {
    await db.query("INSERT INTO clinic_settings (id,name,timezone) VALUES (1,'Doctor Appointment Test','UTC')");
    await db.query("INSERT INTO doctor_profile (id,name,min_lead_minutes,buffer_before_minutes,buffer_after_minutes) VALUES (1,'Synthetic Doctor',0,5,10)");
    for (let i = 0; i < 7; i++) await db.query("INSERT INTO weekly_hours (doctor_id,day,start_minute,end_minute) VALUES (1,$1,540,720)", [i]);
  });
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("patient@example.test"); await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/appointments$/);
  const response = await page.request.post("/api/patient/bookings", { headers: { origin: new URL(page.url()).origin }, data: { requestId: randomUUID(), startsAt: `${day()}T09:05:00Z`, name: "Synthetic Doctor-list Patient", phone: "+919876543210" } });
  expect(response.status()).toBe(200); const booked = (await response.json()).receipt as { id: string };
  await signIn(page); await page.getByRole("link", { name: "Appointments navigation", exact: true }).click();
  await page.getByLabel("Appointment date", { exact: true }).fill(day()); await page.getByRole("button", { name: "Show appointments", exact: true }).click();
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Synthetic Doctor-list Patient");
  return booked;
}
const modal = (page: Page) => page.getByRole("dialog", { name: "Cancel this appointment?", exact: true });
async function open(page: Page) {
  await page.getByRole("button", { name: "Cancel appointment", exact: true }).click();
  try { await expect(modal(page).getByRole("heading")).toBeFocused(); }
  catch (error) {
    console.error("Doctor dialog state:", await page.locator("dialog").evaluateAll((dialogs) => dialogs.map((dialog) => ({
      open: (dialog as HTMLDialogElement).open, label: dialog.getAttribute("aria-labelledby"), heading: dialog.querySelector("h2")?.textContent,
    }))));
    throw error;
  }
}
async function state(id: string) {
  return withDatabase(async (db) => ({
    appointment: (await db.query("SELECT status,reservation_id,cancellation_reason,rebooking_instruction,original_time_blocked FROM appointments WHERE id=$1", [id])).rows[0],
    audit: (await db.query("SELECT count(*)::int AS count FROM booking_audit WHERE appointment_id=$1 AND action='cancelled'", [id])).rows[0].count,
    reservations: (await db.query("SELECT kind,starts_at,ends_at FROM reservations ORDER BY starts_at")).rows,
  }));
}

test("doctor reviews contacts, abandons cancellation by keyboard and cancels with an original-time block on mobile", async ({ page }, testInfo) => {
  const booked = await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("patient@example.test");
  await open(page); await page.keyboard.press("Shift+Tab"); await expect(modal(page).getByRole("button", { name: "Cancel appointment", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(modal(page).getByRole("button", { name: "Close cancellation", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(modal(page)).not.toBeVisible(); await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toBeFocused();
  await open(page); await modal(page).getByRole("button", { name: "Keep appointment", exact: true }).click();
  await open(page); await modal(page).getByRole("button", { name: "Close cancellation", exact: true }).click();
  expect((await state(booked.id)).audit).toBe(0);
  await open(page); await modal(page).getByLabel("Cancellation reason", { exact: true }).fill("Doctor unavailable");
  await modal(page).getByLabel("Rebooking instruction (optional)", { exact: true }).fill("Please choose another available time.");
  await modal(page).getByRole("checkbox").check(); await expect(modal(page)).toContainText("Automatic patient notices are not enabled");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-doctor-cancellation.png") });
  await modal(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Cancelled");
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Cancellation reason: Doctor unavailable");
  const saved = await state(booked.id);
  expect(saved.appointment).toMatchObject({ status: "cancelled", reservation_id: null, original_time_blocked: true }); expect(saved.audit).toBe(1);
  expect(saved.reservations).toEqual([{ kind: "block", starts_at: new Date(`${day()}T09:00:00Z`), ends_at: new Date(`${day()}T09:35:00Z`) }]);
  await page.reload(); await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Cancelled");
  await page.goto("/appointments"); await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Cancelled");
});

test("an uncertain cancellation freezes details and retries the identical body without affecting a new booking", async ({ page }) => {
  const booked = await setup(page); await open(page);
  await modal(page).getByLabel("Cancellation reason", { exact: true }).fill("Doctor unavailable");
  const bodies: string[] = []; let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/appointments", async (route) => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) { await route.fetch(); await gate; await route.abort("failed"); } else await route.continue();
  });
  await modal(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(modal(page).getByRole("button", { name: "Cancelling…", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(modal(page)).toBeVisible(); release();
  await expect(modal(page).getByRole("alert")).toContainText("Cancellation could not be checked");
  await expect(modal(page).getByLabel("Cancellation reason", { exact: true })).toBeDisabled(); await expect(modal(page).getByRole("checkbox")).toBeDisabled();
  const replacement = await page.request.post("/api/patient/bookings", { headers: { origin: new URL(page.url()).origin }, data: { requestId: randomUUID(), startsAt: `${day()}T09:05:00Z`, name: "Replacement Patient", phone: "+919876543210" } });
  expect(replacement.status()).toBe(200);
  await modal(page).getByRole("button", { name: "Retry cancellation", exact: true }).click();
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Replacement Patient");
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
  const saved = await state(booked.id); expect(saved.audit).toBe(1); expect(saved.reservations).toHaveLength(1); expect(saved.reservations[0].kind).toBe("appointment");
});

test("doctor sees empty dates, required reason and conflicts from a visit completed while the dialog was open", async ({ page }) => {
  const booked = await setup(page); await open(page);
  await modal(page).getByRole("button", { name: "Cancel appointment", exact: true }).click(); expect((await state(booked.id)).audit).toBe(0);
  await modal(page).getByLabel("Cancellation reason", { exact: true }).fill("Doctor unavailable");
  await withDatabase(async (db) => { await db.query("UPDATE appointments SET status='completed' WHERE id=$1", [booked.id]); });
  await modal(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toContainText("Only confirmed appointments that have not started");
  await modal(page).getByRole("button", { name: "Keep appointment", exact: true }).click(); await page.getByRole("button", { name: "Refresh appointments", exact: true }).click();
  await expect(page.getByRole("list", { name: "Clinic appointments", exact: true })).toContainText("Completed"); await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toHaveCount(0);
  await page.getByLabel("Appointment date", { exact: true }).fill("2020-01-01"); await page.getByRole("button", { name: "Show appointments", exact: true }).click();
  await expect(page.getByText("No appointments for this date.", { exact: true })).toBeVisible();
});

test("a revoked admin cannot submit from an already open confirmation", async ({ page }) => {
  const booked = await setup(page); await open(page); await modal(page).getByLabel("Cancellation reason", { exact: true }).fill("Doctor unavailable");
  await withDatabase(async (db) => { await db.query("DELETE FROM staff_auth.session WHERE user_id=(SELECT user_id FROM staff_access WHERE role='admin')"); });
  await modal(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(modal(page).getByRole("alert")).toContainText("Admin access is required"); await expect(modal(page).getByRole("link", { name: "Sign in again", exact: true })).toHaveAttribute("href", "/admin");
  expect((await state(booked.id)).appointment.status).toBe("confirmed");
});

test("staff and anonymous visitors cannot open doctor appointments; an unconfigured admin gets a setup prompt", async ({ page }) => {
  await page.goto("/admin/appointments"); await expect(page).toHaveURL(/\/admin$/);
  await signIn(page, true); await expect(page.getByRole("link", { name: "Appointments navigation", exact: true })).toHaveCount(0);
  await page.goto("/admin/appointments"); await expect(page).toHaveURL(/\/admin\/workspace$/);
  expect((await page.request.get("/api/admin/appointments")).status()).toBe(403);
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
  await signIn(page); await page.goto("/admin/appointments"); await expect(page.getByText("Set up your clinic first", { exact: true })).toBeVisible();
});
