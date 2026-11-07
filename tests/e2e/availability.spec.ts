import type { Page } from "@playwright/test";
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
  await page.getByRole("link", { name: "Clinic settings", exact: true }).click();
  await page.getByLabel("Clinic name", { exact: true }).fill("Availability Clinic");
  await page.getByLabel("Doctor name", { exact: true }).fill("Dr Demo");
  await page.getByLabel("Clinic timezone", { exact: true }).selectOption("UTC");
  await page.getByLabel("Minimum notice (minutes)", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Add Monday hours", exact: true }).click();
  await page.getByLabel("Monday closing time 1", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "Copy Monday hours to all days", exact: true }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
  await page.getByRole("link", { name: "Back to workspace" }).click();
  await page.getByRole("link", { name: "Availability", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Availability", exact: true })).toBeVisible();
  const response = await page.request.get("/api/admin/availability");
  const today = (await response.json()).availability.today;
  const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
  const tomorrow = date.toISOString().slice(0, 10);
  await page.getByLabel("Choose date", { exact: true }).fill(tomorrow);
  await page.getByRole("button", { name: "Show day", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Day loaded.");
  await expect(page).toHaveURL(new RegExp(`date=${tomorrow}`));
  await expect(slots(page)).toHaveCount(9);
  return tomorrow;
}
function slots(page: Page) { return page.getByRole("list", { name: "Available appointment slots", exact: true }).getByRole("listitem"); }
async function apply(page: Page, mode: string, message = "Day schedule saved.") {
  await page.getByLabel("Schedule for this day", { exact: true }).selectOption(mode);
  await page.getByRole("button", { name: "Apply schedule", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(message);
}

test("admin marks a holiday, reloads it and restores weekly hours", async ({ page }, testInfo) => {
  const date = await prepare(page);
  await page.getByLabel("Schedule for this day", { exact: true }).selectOption("closed");
  await page.getByLabel("Schedule note (optional)", { exact: true }).fill("Clinic holiday");
  await page.getByRole("button", { name: "Apply schedule", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Day schedule saved.");
  await expect(slots(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Choose date", { exact: true })).toHaveValue(date);
  await expect(page.getByText("Note: Clinic holiday", { exact: true })).toBeVisible();
  await expect(slots(page)).toHaveCount(0);
  await apply(page, "weekly", "Weekly hours restored. Existing breaks remain blocked.");
  await expect(slots(page)).toHaveCount(9);
  const settings = await (await page.request.get("/api/admin/settings")).json();
  expect(settings.settings.weeklyHours.every((day: { intervals: unknown[] }) => day.intervals.length === 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("desktop-availability.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-availability.png"), fullPage: true });
});

test("special hours replace only the selected day and reject overlapping intervals", async ({ page }) => {
  const date = await prepare(page);
  await page.getByLabel("Schedule for this day", { exact: true }).selectOption("custom");
  await page.getByLabel("Special opening time 1", { exact: true }).fill("14:00");
  await page.getByLabel("Special closing time 1", { exact: true }).fill("16:00");
  await page.getByRole("button", { name: "Apply schedule", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Day schedule saved.");
  await expect(slots(page)).toHaveCount(6);
  await expect(slots(page).first()).toContainText("2:00 PM");
  await page.getByRole("button", { name: "Add special hours", exact: true }).click();
  await page.getByLabel("Special opening time 2", { exact: true }).fill("15:00");
  await page.getByLabel("Special closing time 2", { exact: true }).fill("17:00");
  await page.getByRole("button", { name: "Apply schedule", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("must not overlap");
  await expect(slots(page)).toHaveCount(6);
  const other = new Date(`${date}T12:00Z`); other.setUTCDate(other.getUTCDate() + 1);
  const response = await page.request.get(`/api/admin/availability?date=${other.toISOString().slice(0, 10)}`);
  expect((await response.json()).availability.slots).toHaveLength(9);
});

test("multiple daily breaks persist, reject overlaps and can be removed independently", async ({ page }) => {
  await prepare(page);
  await page.getByLabel("Break starts", { exact: true }).fill("09:20");
  await page.getByLabel("Break ends", { exact: true }).fill("09:40");
  await page.getByLabel("Break note (optional)", { exact: true }).fill("Personal work");
  await page.getByRole("button", { name: "Add break", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Break added.");
  await expect(slots(page)).toHaveCount(8);
  await page.getByRole("button", { name: "Add break", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("overlaps an existing break");
  await expect(page.getByRole("list", { name: "Saved breaks" }).getByRole("listitem")).toHaveCount(1);
  await page.getByLabel("Break starts", { exact: true }).fill("11:00");
  await page.getByLabel("Break ends", { exact: true }).fill("11:20");
  await page.getByLabel("Break note (optional)", { exact: true }).fill("Second break");
  await page.getByRole("button", { name: "Add break", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Break added.");
  await expect(page.getByRole("list", { name: "Saved breaks" }).getByRole("listitem")).toHaveCount(2);
  await expect(slots(page)).toHaveCount(7);
  await apply(page, "closed");
  await expect(page.getByText(/The clinic is closed on this date, so one-off breaks do not apply/)).toBeVisible();
  await expect(page.getByLabel("Break starts", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Saved breaks" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply schedule", exact: true })).toBeDisabled();
  await apply(page, "weekly", "Weekly hours restored. Existing breaks remain blocked.");
  await expect(slots(page)).toHaveCount(7);
  await page.reload();
  await expect(page.getByText("Personal work", { exact: true })).toBeVisible();
  await expect(page.getByText("Second break", { exact: true })).toBeVisible();
  const breaks = page.getByRole("list", { name: "Saved breaks" });
  await expect(breaks.getByRole("listitem")).toHaveCount(2);
  await breaks.getByRole("listitem").filter({ hasText: "Personal work" }).getByRole("button").click();
  await expect(page.getByRole("status")).toHaveText("Break removed.");
  await expect(slots(page)).toHaveCount(8);
  await expect(breaks.getByRole("listitem")).toHaveCount(1);
  await expect(breaks).toContainText("Second break");
  await expect(slots(page).filter({ hasText: "9:20 AM – 9:40 AM" })).toHaveCount(1);
  await expect(slots(page).filter({ hasText: "11:00 AM – 11:20 AM" })).toHaveCount(0);
  await breaks.getByRole("button", { name: /^Remove break / }).click();
  await expect(page.getByRole("status")).toHaveText("Break removed.");
  await expect(slots(page)).toHaveCount(9);
});

test("unloaded dates disable edits and failed saves can be retried", async ({ page }) => {
  const selected = await prepare(page);
  await page.getByLabel("Break starts", { exact: true }).fill("11:00");
  await page.getByLabel("Break ends", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Add break", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("finish after it starts");
  await page.route("**/api/admin/availability?*", async (route) => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Please try again." }) });
    else await route.continue();
  });
  await page.getByLabel("Schedule for this day", { exact: true }).selectOption("closed");
  await page.getByRole("button", { name: "Apply schedule", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Please try again.");
  await expect(slots(page)).toHaveCount(9);
  await expect(page.getByRole("button", { name: "Apply schedule", exact: true })).toBeEnabled();
  await page.unroute("**/api/admin/availability?*");
  await page.getByRole("button", { name: "Apply schedule", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Day schedule saved.");
  const other = new Date(`${selected}T12:00Z`); other.setUTCDate(other.getUTCDate() + 1);
  await page.getByLabel("Choose date", { exact: true }).fill(other.toISOString().slice(0, 10));
  await expect(page.getByRole("button", { name: "Apply schedule", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add break", exact: true })).toHaveCount(0);
});

test("Apply schedule tracks dropdown, special-hours and note edits and resets on save or revert", async ({ page }) => {
  await prepare(page);
  const applyButton = page.getByRole("button", { name: "Apply schedule", exact: true });
  const mode = page.getByLabel("Schedule for this day", { exact: true });
  await expect(applyButton).toBeDisabled();
  await page.getByLabel("Break starts", { exact: true }).fill("10:00");
  await expect(applyButton).toBeDisabled();
  await mode.selectOption("closed");
  await expect(applyButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "Add break", exact: true })).toHaveCount(0);
  await expect(page.getByText("Apply your schedule changes before managing one-off breaks.", { exact: true })).toBeVisible();
  await mode.selectOption("weekly");
  await expect(applyButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add break", exact: true })).toBeVisible();
  await apply(page, "custom");
  await expect(applyButton).toBeDisabled();
  await page.getByLabel("Special closing time 1", { exact: true }).fill("11:00");
  await expect(applyButton).toBeEnabled();
  await page.getByLabel("Special closing time 1", { exact: true }).fill("12:00");
  await expect(applyButton).toBeDisabled();
  await page.getByLabel("Special closing time 1", { exact: true }).fill("11:00");
  await applyButton.click();
  await expect(page.getByRole("status")).toHaveText("Day schedule saved.");
  await expect(applyButton).toBeDisabled();
  await page.getByLabel("Schedule note (optional)", { exact: true }).fill("Updated hours");
  await expect(applyButton).toBeEnabled();
  await page.getByLabel("Schedule note (optional)", { exact: true }).fill("");
  await expect(applyButton).toBeDisabled();
  await page.getByLabel("Schedule note (optional)", { exact: true }).fill("Updated hours");
  await applyButton.click();
  await expect(applyButton).toBeDisabled();
  await page.reload();
  await expect(mode).toHaveValue("custom");
  await expect(page.getByLabel("Special closing time 1", { exact: true })).toHaveValue("11:00");
  await expect(page.getByLabel("Schedule note (optional)", { exact: true })).toHaveValue("Updated hours");
  await expect(applyButton).toBeDisabled();
});

test("a normally closed weekday hides saved break controls until reopened", async ({ page }, testInfo) => {
  const date = await prepare(page);
  await page.getByLabel("Break starts", { exact: true }).fill("10:00");
  await page.getByLabel("Break ends", { exact: true }).fill("10:20");
  await page.getByRole("button", { name: "Add break", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Break added.");
  const before = (await (await page.request.get(`/api/admin/availability?date=${date}`)).json()).availability;
  const settings = (await (await page.request.get("/api/admin/settings")).json()).settings;
  const weekday = (new Date(`${date}T12:00Z`).getUTCDay() + 6) % 7;
  const savedHours = settings.weeklyHours[weekday].intervals;
  settings.weeklyHours[weekday].intervals = [];
  const headers = { origin: new URL(page.url()).origin };
  expect((await page.request.put("/api/admin/settings", { headers, data: settings })).status()).toBe(200);
  await page.reload();
  await expect(page.getByText(/The clinic is closed on this date, so one-off breaks do not apply/)).toBeVisible();
  await expect(page.getByLabel("Break starts", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Saved breaks" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply schedule", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("closed-day-breaks.png"), fullPage: true, animations: "disabled" });
  settings.weeklyHours[weekday].intervals = savedHours;
  expect((await page.request.put("/api/admin/settings", { headers, data: settings })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("list", { name: "Saved breaks" }).getByRole("listitem")).toHaveCount(1);
  const reopened = (await (await page.request.get(`/api/admin/availability?date=${date}`)).json()).availability;
  expect(reopened.blocks).toEqual(before.blocks);
  await expect(slots(page)).toHaveCount(8);
});

test("availability requires sign-in and clinic setup", async ({ page }) => {
  await page.goto("/admin/availability"); await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/availability")).status()).toBe(401);
  await signIn(page); await page.goto("/admin/availability");
  await expect(page.getByRole("heading", { name: "Set up your clinic first", exact: true })).toBeVisible();
});
