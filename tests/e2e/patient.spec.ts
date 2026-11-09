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
async function requestCode(page: Page, email = "patient@example.test") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByLabel("Code", { exact: true })).toBeFocused();
}
async function signIn(page: Page, email = "patient@example.test") {
  await requestCode(page, email);
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
}
async function seedAppointments() {
  return withDatabase(async (client) => {
    await client.query("INSERT INTO clinic_settings (id, name, timezone) VALUES (1, 'Patient Test Clinic', 'UTC')");
    await client.query("INSERT INTO doctor_profile (id, name) VALUES (1, 'Doctor')");
    const users = await client.query("SELECT id, email FROM patient_auth.\"user\"");
    const admin = (await client.query("SELECT user_id FROM staff_access WHERE role = 'admin'")).rows[0].user_id;
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), past = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const result: Record<string, string> = {};
    for (const [key, email, day, time, status] of [
      ["own", "patient@example.test", future, "09:00", "confirmed"],
      ["past", "patient@example.test", past, "09:00", "completed"],
      ["cancelled", "patient@example.test", future, "10:00", "cancelled"],
      ["other", "other@example.test", future, "11:00", "confirmed"],
      ["clinic", "", future, "12:00", "confirmed"],
    ]) {
      const id = randomUUID(), startsAt = new Date(`${day}T${time}:00Z`), endsAt = new Date(startsAt.getTime() + 20 * 60_000);
      const reservation = (await client.query("INSERT INTO reservations (doctor_id, kind, starts_at, ends_at) VALUES (1, 'appointment', $1, $2) RETURNING id", [startsAt, endsAt])).rows[0].id;
      const userId = email ? users.rows.find((user) => user.email === email).id : null;
      await client.query("INSERT INTO appointments (id, doctor_id, reservation_id, patient_user_id, created_by_staff_id, source, status, contact_ciphertext, starts_at, ends_at, timezone, duration_minutes, buffer_before_minutes, buffer_after_minutes) VALUES ($1, 1, $2, $3, $4, $5, $6, 'protected-test-contact', $7, $8, 'Asia/Kolkata', 20, 0, 0)", [id, reservation, userId, userId ? null : admin, userId ? "patient" : "clinic", status, startsAt, endsAt]);
      result[key] = id;
    }
    return result;
  });
}

test("patient signs in from home, sees an empty account and signs out", async ({ page, context }, testInfo) => {
  await page.goto("/"); await page.getByRole("link", { name: "Patient sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Patient sign in", exact: true })).toBeVisible();
  await expect(page.getByLabel("PIN", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("desktop-patient-login.png"), fullPage: true });
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Enter a valid email address.");
  await page.getByLabel("Email", { exact: true }).fill(" PATIENT@example.test ");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByLabel("Code", { exact: true })).toBeFocused();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No appointments yet", exact: true })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "nuvortiq-patient.session_token")?.httpOnly).toBe(true);
  const response = await page.request.get("/appointments"); expect(response.headers()["cache-control"]).toContain("no-store");
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
  await page.goto("/appointments"); await expect(page).toHaveURL(/\/login$/);
});

test("mobile keyboard login shows only owned appointments in their saved timezone", async ({ page }, testInfo) => {
  const ids = await seedAppointments();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("patient@example.test");
  await page.getByLabel("Email", { exact: true }).press("Enter");
  await expect(page.getByLabel("Code", { exact: true })).toBeFocused();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.screenshot({ path: testInfo.outputPath("mobile-patient-code.png"), fullPage: true });
  await page.getByLabel("Code", { exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
  const upcoming = page.getByRole("list", { name: "Upcoming appointments", exact: true });
  await expect(upcoming.getByRole("listitem")).toHaveCount(1);
  await expect(upcoming).toContainText("2:30 PM"); await expect(upcoming).toContainText("2:50 PM");
  await expect(upcoming).toContainText("Asia/Kolkata");
  await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Completed");
  await expect(page.getByRole("list", { name: "Appointment history", exact: true })).toContainText("Cancelled");
  const response = await page.request.get(`/api/patient/appointments?patientUserId=another&appointmentId=${ids.other}`);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const data = await response.json();
  expect(data.appointments.map((row: { id: string }) => row.id).sort()).toEqual([ids.own, ids.past, ids.cancelled].sort());
  expect(JSON.stringify(data)).not.toContain("protected-test-contact"); expect(JSON.stringify(data)).not.toContain(ids.other); expect(JSON.stringify(data)).not.toContain(ids.clinic);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-patient-appointments.png"), fullPage: true });
  await page.getByRole("button", { name: "Refresh appointments", exact: true }).click();
  await expect(upcoming.getByRole("listitem")).toHaveCount(1);
});

test("expired codes show feedback and a new code can be requested", async ({ page }) => {
  await requestCode(page);
  await withDatabase(async (client) => { await client.query("UPDATE patient_auth.verification SET expires_at = '1970-01-01' WHERE identifier LIKE '%patient@example.test%'"); });
  await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("invalid or expired");
  await page.getByRole("button", { name: "Request new code", exact: true }).click();
  await expect(page.getByLabel("Code", { exact: true })).toHaveValue("");
  await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  expect((await page.request.post("/api/auth/patient/sign-in/email-otp", { headers: { origin }, data: { email: "patient@example.test", otp: "0000" } })).status()).toBeGreaterThanOrEqual(400);
});

test("new patients register through the same code sign-in without an account-creation screen", async ({ page }) => {
  const account = () => withDatabase(async (client) => (await client.query("SELECT id FROM patient_auth.\"user\" WHERE email = 'new-visitor@example.test'")).rows);
  expect(await account()).toHaveLength(0);
  await requestCode(page, "new-visitor@example.test");
  expect(await account()).toHaveLength(0);
  await page.getByRole("button", { name: "Use another email", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("new-visitor@example.test");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Code", { exact: true }).fill("1111"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  expect(await account()).toHaveLength(0);
  await page.getByLabel("Code", { exact: true }).fill("0000"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No appointments yet", exact: true })).toBeVisible();
  const [created] = await account(); expect(created.id).toBeTruthy();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, "new-visitor@example.test");
  expect((await account()).map((row) => row.id)).toEqual([created.id]);
});

test("same-email patient and admin sessions stay independent, including sign-out", async ({ page }) => {
  await signIn(page, "doctor@example.test");
  await page.goto("/admin/workspace"); await expect(page).toHaveURL(/\/admin$/);
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test"); await page.getByLabel("PIN", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/admin\/workspace$/);
  await page.goto("/appointments"); await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
  await page.goto("/admin/workspace"); await expect(page.getByRole("heading", { name: "Clinic workspace", exact: true })).toBeVisible();
  expect((await page.request.get("/api/patient/appointments")).status()).toBe(401);
  await signIn(page, "doctor@example.test");
  await page.goto("/admin/workspace"); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/appointments"); await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
});

test("revoked patient sessions redirect to login and cannot read the endpoint", async ({ page }) => {
  await signIn(page);
  await withDatabase(async (client) => { await client.query("DELETE FROM patient_auth.session WHERE user_id = (SELECT id FROM patient_auth.\"user\" WHERE email = 'patient@example.test')"); });
  expect((await page.request.get("/api/patient/appointments")).status()).toBe(401);
  await page.goto("/appointments"); await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/auth/patient/get-session")).status()).toBe(404);
});

test("failed code requests keep details, prevent duplicates and allow retry", async ({ page }) => {
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill("patient@example.test");
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/patient/email-otp/send-verification-otp", async (route) => { await gate; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Sign-in is temporarily unavailable. Please try again." }) }); });
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await expect(page.getByRole("button", { name: "Requesting code…", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  release(); await expect(page.locator("main").getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("patient@example.test");
  await page.unroute("**/api/auth/patient/email-otp/send-verification-otp");
  await page.getByRole("button", { name: "Send code", exact: true }).click(); await expect(page.getByLabel("Code", { exact: true })).toBeFocused();
});

test("failed patient sign-out keeps the account visible and can be retried", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/auth/patient/sign-out", (route) => route.fulfill({ status: 503 }));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator("header").getByRole("alert")).toContainText("Unable to sign out");
  await expect(page.getByRole("heading", { name: "My appointments", exact: true })).toBeVisible();
  await page.unroute("**/api/auth/patient/sign-out");
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page).toHaveURL(/\/login$/);
});
