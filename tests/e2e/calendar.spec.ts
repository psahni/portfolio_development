import type { Page } from "@playwright/test";
import { Client } from "pg";
import { emptyConfiguration } from "../../src/modules/clinic/configuration";
import { test, expect } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test");
  await page.getByLabel("PIN", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinic workspace", exact: true })).toBeVisible();
}
async function prepare(page: Page) {
  await signIn(page);
  const settings = { ...emptyConfiguration(), clinicName: "Calendar Clinic", doctorName: "Doctor", timezone: "UTC", minLeadMinutes: 0 };
  settings.weeklyHours.forEach((day) => { day.intervals = [{ start: "09:00", end: "12:00" }]; });
  expect((await page.request.put("/api/admin/settings", { headers: { origin: new URL(page.url()).origin }, data: settings })).status()).toBe(200);
  await page.reload();
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Doctor calendar", exact: true })).toBeVisible();
  const view = (await (await page.request.get("/api/admin/calendar")).json()).calendar;
  const date = new Date(`${view.today}T12:00Z`); date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
async function seedBooked(date: string, start = "09:20", end = "09:40") {
  const connectionString = process.env.NUVORTIQ_E2E_DATABASE_URL;
  if (!connectionString || new URL(connectionString).pathname !== "/nuvortiq_browser") throw new Error("Expected the isolated browser database.");
  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query("INSERT INTO reservations (doctor_id, kind, starts_at, ends_at) VALUES (1, 'appointment', $1, $2)", [`${date}T${start}Z`, `${date}T${end}Z`]);
  } finally { await client.end(); }
}
async function showDate(page: Page, date: string) {
  await page.getByLabel("Calendar date", { exact: true }).fill(date);
  await page.getByRole("button", { name: "Show date", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Calendar updated.");
  await expect(page).toHaveURL(new RegExp(`date=${date}`));
}

test("calendar displays available, booked and break times with different colors and labels", async ({ page }, testInfo) => {
  const date = await prepare(page);
  await seedBooked(date);
  expect((await page.request.post("/api/admin/availability", { headers: { origin: new URL(page.url()).origin }, data: { date, start: "09:40", end: "10:00", reason: "Personal work" } })).status()).toBe(200);
  await showDate(page, date);
  await expect(page.getByRole("region", { name: "Week calendar", exact: true })).toBeVisible();
  const slots = page.getByRole("list", { name: `Slots for ${date}`, exact: true });
  await expect(slots.locator('[data-kind="available"]')).toHaveCount(7);
  await expect(slots.locator('[data-kind="appointment"]')).toHaveText("Booked9:20 AM – 9:40 AM");
  await expect(slots.locator('[data-kind="block"]')).toContainText("Break");
  await expect(slots.locator('[data-kind="block"]')).toContainText("Personal work");
  const backgrounds = [];
  for (const kind of ["available", "appointment", "block"]) backgrounds.push(await slots.locator(`[data-kind="${kind}"]`).first().evaluate((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(backgrounds).size).toBe(3);
  await expect(page.getByRole("list", { name: "Calendar legend" })).toContainText("Available");
  await page.screenshot({ path: testInfo.outputPath("desktop-calendar.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page.getByRole("region", { name: "Day calendar", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Day", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect((await page.getByLabel("Calendar date", { exact: true }).boundingBox())!.width).toBeGreaterThan(180);
  await expect(slots.locator('[data-kind="appointment"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("mobile-calendar.png"), fullPage: true, animations: "disabled" });
  const view = (await (await page.request.get(`/api/admin/calendar?date=${date}&view=day`)).json()).calendar;
  expect(view.days[0].events.filter((event: { kind: string }) => event.kind !== "available")).toHaveLength(2);
});

test("calendar navigation, refresh and reload preserve date/view and show new bookings", async ({ page }) => {
  const date = await prepare(page); await showDate(page, date);
  await page.getByRole("button", { name: "Day", exact: true }).click();
  await expect(page).toHaveURL(/view=day/);
  await seedBooked(date);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const slots = page.getByRole("list", { name: `Slots for ${date}`, exact: true });
  await expect(slots.locator('[data-kind="appointment"]')).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("Calendar date", { exact: true })).toHaveValue(date);
  await expect(page.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(page.locator('[data-kind="appointment"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Previous day", exact: true }).click();
  await expect(slots.locator('[data-kind="appointment"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.getByRole("region", { name: "Week calendar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.locator('[data-kind="appointment"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(slots.locator('[data-kind="appointment"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const today = (await (await page.request.get("/api/admin/calendar")).json()).calendar.today;
  await expect(page.getByLabel("Calendar date", { exact: true })).toHaveValue(today);
  await page.getByLabel("Calendar date", { exact: true }).fill(date);
  await page.getByLabel("Calendar date", { exact: true }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`date=${date}`));
});

test("closed days hide availability but retain existing booked times", async ({ page }) => {
  const date = await prepare(page);
  expect((await page.request.put("/api/admin/availability", { headers: { origin: new URL(page.url()).origin }, data: { date, mode: "closed" } })).status()).toBe(200);
  await showDate(page, date);
  const slots = page.getByRole("list", { name: `Slots for ${date}`, exact: true });
  await expect(slots.getByRole("listitem")).toHaveCount(0);
  await seedBooked(date);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(slots.locator('[data-kind="appointment"]')).toHaveCount(1);
  await expect(slots.locator('[data-kind="available"]')).toHaveCount(0);
});

test("failed calendar loads preserve displayed data and allow retry", async ({ page }) => {
  const date = await prepare(page); await showDate(page, date);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/calendar?*", async (route) => { await gate; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Calendar is temporarily unavailable. Please try again." }) }); });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next week", exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Please try again");
  await expect(page.getByRole("list", { name: `Slots for ${date}`, exact: true }).getByRole("listitem")).toHaveCount(9);
  await page.unroute("**/api/admin/calendar?*");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
});

test("calendar requires admin access and clinic configuration", async ({ page }) => {
  await page.goto("/admin/calendar"); await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/calendar")).status()).toBe(401);
  await signIn(page); await page.goto("/admin/calendar");
  await expect(page.getByRole("heading", { name: "Set up your clinic first", exact: true })).toBeVisible();
  await page.goto("/admin/workspace"); await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill("staff@example.test");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/workspace$/);
  await expect(page.getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
  await page.goto("/admin/calendar"); await expect(page).toHaveURL(/\/admin\/workspace$/);
  expect((await page.request.get("/api/admin/calendar")).status()).toBe(403);
});
