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
async function setup(page: Page) {
  await withDatabase(async (client) => {
    await client.query("INSERT INTO clinic_settings (id, name, timezone) VALUES (1, 'Cancellation Test Clinic', 'UTC')");
    await client.query("INSERT INTO doctor_profile (id, name, min_lead_minutes) VALUES (1, 'Synthetic Doctor', 0)");
    for (let weekday = 0; weekday < 7; weekday++) await client.query("INSERT INTO weekly_hours (doctor_id, day, start_minute, end_minute) VALUES (1, $1, 540, 720)", [weekday]);
  });
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("patient@example.test"); await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/appointments$/);
}
async function book(page: Page) {
  const response = await page.request.post("/api/patient/bookings", { headers: { origin: new URL(page.url()).origin }, data: { requestId: randomUUID(), startsAt: `${day()}T09:00:00Z`, name: "Synthetic Cancellation Patient", phone: "+919876543210" } });
  expect(response.status()).toBe(200); return (await response.json()).receipt as { id: string; startsAt: string; endsAt: string };
}
async function state(id: string) {
  return withDatabase(async (client) => {
    const row = (await client.query("SELECT status, reservation_id FROM appointments WHERE id=$1", [id])).rows[0];
    const counts = (await client.query("SELECT (SELECT count(*)::int FROM booking_audit WHERE appointment_id=$1 AND action='cancelled') AS cancellations, (SELECT count(*)::int FROM reservations WHERE kind='appointment') AS reservations", [id])).rows[0];
    return { ...row, ...counts };
  });
}
const dialog = (page: Page) => page.getByRole("dialog", { name: "Cancel this appointment?", exact: true });
async function open(page: Page) {
  await page.getByRole("list", { name: "Upcoming appointments", exact: true }).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Cancel this appointment?", exact: true })).toBeFocused();
}

test("mobile keyboard cancellation confirms, releases the slot and retains cancelled history", async ({ page }, testInfo) => {
  await setup(page); const booked = await book(page); await page.reload(); await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", { name: "Cancel appointment", exact: true }); await trigger.focus(); await trigger.press("Enter");
  const modal = dialog(page); await expect(modal.getByRole("heading")).toBeFocused(); await expect(modal).toContainText("9:00 AM UTC");
  await page.keyboard.press("Shift+Tab"); await expect(modal.getByRole("button", { name: "Cancel appointment", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(modal.getByRole("button", { name: "Close cancellation", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(modal.getByRole("button", { name: "Keep appointment", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(modal).not.toBeVisible(); await expect(trigger).toBeFocused();
  expect(await state(booked.id)).toMatchObject({ status: "confirmed", cancellations: 0, reservations: 1 });
  await open(page); await modal.getByRole("button", { name: "Keep appointment", exact: true }).click(); await expect(modal).not.toBeVisible();
  await open(page); await modal.getByRole("button", { name: "Close cancellation", exact: true }).click(); await expect(modal).not.toBeVisible();
  expect(await state(booked.id)).toMatchObject({ status: "confirmed", cancellations: 0, reservations: 1 });
  await open(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-patient-cancellation.png") });
  const confirm = modal.getByRole("button", { name: "Cancel appointment", exact: true }); await confirm.focus(); await confirm.press("Enter");
  await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Cancelled");
  await expect(page.getByText("You have no upcoming appointments.", { exact: true })).toBeVisible();
  expect(await state(booked.id)).toEqual({ status: "cancelled", reservation_id: null, cancellations: 1, reservations: 0 });
  const availability = await (await page.request.get(`/api/patient/availability?date=${day()}`)).json();
  expect(availability.availability.slots.some((slot: { startsAt: string }) => slot.startsAt === booked.startsAt)).toBe(true);
  await page.reload(); await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Cancelled"); await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toHaveCount(0);
});

test("lost cancellation responses retry safely even after the time is booked again", async ({ page }, testInfo) => {
  await setup(page); const booked = await book(page); await page.reload(); await open(page);
  const bodies: string[] = []; let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/patient/appointments/cancel", async (route) => {
    bodies.push(route.request().postData()!);
    if (bodies.length === 1) { await route.fetch(); await gate; await route.abort("failed"); } else await route.continue();
  });
  await dialog(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog(page).getByRole("button", { name: "Cancelling…", exact: true })).toBeDisabled();
  await expect(dialog(page).getByRole("button", { name: "Keep appointment", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape"); await expect(dialog(page)).toBeVisible(); release();
  await expect(dialog(page).getByRole("alert")).toContainText("Cancellation couldn’t be checked");
  await expect(dialog(page).getByRole("button", { name: "Close", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("desktop-cancellation-retry.png") });
  const replacement = await book(page); expect(replacement.id).not.toBe(booked.id);
  await dialog(page).getByRole("button", { name: "Retry cancellation", exact: true }).click();
  await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Cancelled");
  await expect(page.getByRole("list", { name: "Upcoming appointments", exact: true }).getByRole("listitem")).toHaveCount(1);
  expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1]);
  expect(await state(booked.id)).toEqual({ status: "cancelled", reservation_id: null, cancellations: 1, reservations: 1 });
  expect(await state(replacement.id)).toMatchObject({ status: "confirmed", cancellations: 0, reservations: 1 });
});

test("failed cancellation can close and refresh without pretending the appointment was kept", async ({ page }) => {
  await setup(page); const booked = await book(page); await page.reload(); await open(page);
  await page.route("**/api/patient/appointments/cancel", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Cancellation couldn’t be checked. Retry cancellation or refresh My appointments." }) }));
  await dialog(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Cancellation couldn’t be checked");
  expect(await state(booked.id)).toMatchObject({ status: "confirmed", cancellations: 0, reservations: 1 });
  await dialog(page).getByRole("button", { name: "Close", exact: true }).click(); await expect(dialog(page)).not.toBeVisible();
  await page.unroute("**/api/patient/appointments/cancel"); await open(page); await dialog(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Cancelled"); expect(await state(booked.id)).toMatchObject({ status: "cancelled", cancellations: 1, reservations: 0 });
});

test("a revoked session cannot cancel an appointment from an already open modal", async ({ page }) => {
  await setup(page); const booked = await book(page); await page.reload(); await open(page);
  await withDatabase(async (client) => { await client.query("DELETE FROM patient_auth.session WHERE user_id=(SELECT id FROM patient_auth.\"user\" WHERE email='patient@example.test')"); });
  await dialog(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Sign in to cancel"); await expect(dialog(page).getByRole("link", { name: "Sign in again", exact: true })).toHaveAttribute("href", "/login");
  expect(await state(booked.id)).toMatchObject({ status: "confirmed", cancellations: 0, reservations: 1 });
});

test("an appointment completed after the page loaded cannot be cancelled", async ({ page }) => {
  await setup(page); const booked = await book(page); await page.reload(); await open(page);
  await withDatabase(async (client) => { await client.query("UPDATE appointments SET status='completed' WHERE id=$1", [booked.id]); });
  await dialog(page).getByRole("button", { name: "Cancel appointment", exact: true }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("Only confirmed appointments that have not started");
  expect(await state(booked.id)).toMatchObject({ status: "completed", cancellations: 0, reservations: 1 });
  await dialog(page).getByRole("button", { name: "Keep appointment", exact: true }).click(); await page.getByRole("button", { name: "Refresh appointments", exact: true }).click();
  await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Completed"); await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toHaveCount(0);
});

test("only an owned future confirmed appointment offers cancellation; forged IDs are rejected", async ({ page }) => {
  await setup(page); const booked = await book(page);
  const hidden = await withDatabase(async (client) => {
    const owner = (await client.query("SELECT id FROM patient_auth.\"user\" WHERE email='patient@example.test'")).rows[0].id;
    const other = (await client.query("SELECT id FROM patient_auth.\"user\" WHERE email='other@example.test'")).rows[0].id;
    const admin = (await client.query("SELECT user_id FROM staff_access WHERE role='admin'")).rows[0].user_id;
    const ids: string[] = [];
    const started = new Date(Math.floor(Date.now() / 60_000) * 60_000 - 5 * 60_000);
    for (const [patient, staff, start, status] of [
      [other, null, new Date(`${day()}T09:20:00Z`), "confirmed"], [null, admin, new Date(`${day()}T09:40:00Z`), "confirmed"],
      [owner, null, new Date(`${day()}T10:00:00Z`), "completed"], [owner, null, new Date(`${day()}T10:20:00Z`), "no_show"],
      [owner, null, started, "confirmed"], [owner, null, new Date(Date.now() - 2 * 86_400_000), "completed"],
    ] as const) {
      const id = randomUUID(), endsAt = new Date(start.getTime() + 20 * 60_000);
      const reservation = (await client.query("INSERT INTO reservations (doctor_id, kind, starts_at, ends_at) VALUES (1, 'appointment', $1, $2) RETURNING id", [start, endsAt])).rows[0].id;
      await client.query("INSERT INTO appointments (id,doctor_id,reservation_id,patient_user_id,created_by_staff_id,source,status,contact_ciphertext,starts_at,ends_at,timezone,duration_minutes,buffer_before_minutes,buffer_after_minutes) VALUES ($1,1,$2,$3,$4,$5,$6,'synthetic-protected-contact',$7,$8,'UTC',20,0,0)", [id,reservation,patient,staff,patient ? "patient" : "clinic",status,start,endsAt]);
      ids.push(id);
    }
    return ids.slice(0, 2);
  });
  await page.reload(); await expect(page.getByRole("button", { name: "Cancel appointment", exact: true })).toHaveCount(1);
  for (const appointmentId of [...hidden, randomUUID()]) {
    const response = await page.request.post("/api/patient/appointments/cancel", { headers: { origin: new URL(page.url()).origin }, data: { appointmentId } });
    expect(response.status()).toBe(404); expect(await response.json()).toEqual({ code: "APPOINTMENT_NOT_FOUND", error: "This appointment was not found." });
  }
  expect(await state(booked.id)).toMatchObject({ status: "confirmed", cancellations: 0, reservations: 7 });
});
