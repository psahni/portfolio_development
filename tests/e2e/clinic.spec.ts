import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function openSettings(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test");
  await page.getByLabel("PIN", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: "Clinic settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinic settings", exact: true })).toBeVisible();
}

async function fillRequired(page: Page) {
  await page.getByLabel("Clinic name", { exact: true }).fill("Riverbank Clinic");
  await page.getByLabel("Doctor name", { exact: true }).fill("Dr Demo");
  await page.getByLabel("Clinic timezone", { exact: true }).selectOption("Asia/Kolkata");
}

test("admin saves clinic details and split weekly hours, reloads and edits them", async ({ page }, testInfo) => {
  await openSettings(page);
  await expect(page.getByLabel("Clinic timezone", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Appointment duration (minutes)", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Minimum notice (minutes)", { exact: true })).toHaveValue("60");
  await expect(page.getByLabel("Book ahead (days)", { exact: true })).toHaveValue("30");
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(7);
  await fillRequired(page);
  await page.getByLabel("Contact email (optional)", { exact: true }).fill("hello@example.test");
  await page.getByLabel("Contact phone (optional)", { exact: true }).fill("+91 98765 43210");
  for (const [label, value] of [["Appointment duration (minutes)", "30"], ["Buffer before (minutes)", "5"], ["Buffer after (minutes)", "10"], ["Minimum notice (minutes)", "90"], ["Book ahead (days)", "45"]]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole("button", { name: "Add Monday hours", exact: true }).click();
  await page.getByLabel("Monday closing time 1", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "Add Monday hours", exact: true }).click();
  await page.getByLabel("Monday opening time 2", { exact: true }).fill("13:00");
  await page.getByLabel("Monday closing time 2", { exact: true }).fill("17:00");
  await page.getByRole("button", { name: "Add Tuesday hours", exact: true }).click();
  await page.getByRole("button", { name: "Remove Tuesday interval 1", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("desktop-settings.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("group", { name: "Monday hours", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mobile-weekly-hours.png") });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
  await page.reload();
  await expect(page.getByLabel("Clinic name", { exact: true })).toHaveValue("Riverbank Clinic");
  await expect(page.getByLabel("Doctor name", { exact: true })).toHaveValue("Dr Demo");
  await expect(page.getByLabel("Contact email (optional)", { exact: true })).toHaveValue("hello@example.test");
  await expect(page.getByLabel("Contact phone (optional)", { exact: true })).toHaveValue("+91 98765 43210");
  await expect(page.getByLabel("Clinic timezone", { exact: true })).toHaveValue("Asia/Kolkata");
  await expect(page.getByLabel("Monday opening time 1", { exact: true })).toHaveValue("09:00");
  await expect(page.getByLabel("Monday closing time 1", { exact: true })).toHaveValue("12:00");
  await expect(page.getByLabel("Monday opening time 2", { exact: true })).toHaveValue("13:00");
  await expect(page.getByLabel("Monday closing time 2", { exact: true })).toHaveValue("17:00");
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(6);
  await page.getByLabel("Clinic name", { exact: true }).fill("Riverbank Clinic Updated");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
  await page.reload();
  await expect(page.getByLabel("Clinic name", { exact: true })).toHaveValue("Riverbank Clinic Updated");
});

test("overlapping weekly hours are explained without changing saved settings", async ({ page }) => {
  await openSettings(page);
  const before = await (await page.request.get("/api/admin/settings")).json();
  await fillRequired(page);
  const monday = page.getByRole("group", { name: "Monday hours", exact: true });
  while (await monday.getByRole("button", { name: /Remove Monday interval/ }).count()) {
    await monday.getByRole("button", { name: /Remove Monday interval/ }).first().click();
  }
  await page.getByRole("button", { name: "Add Monday hours", exact: true }).click();
  await page.getByRole("button", { name: "Add Monday hours", exact: true }).click();
  await page.getByLabel("Monday opening time 2", { exact: true }).fill("16:00");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Monday hours must not overlap.");
  expect(await (await page.request.get("/api/admin/settings")).json()).toEqual(before);
});

test("staff cannot see the settings link or read/write clinic settings", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("staff@example.test");
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clinic settings", exact: true })).toHaveCount(0);
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/workspace$/);
  expect((await page.request.get("/api/admin/settings")).status()).toBe(403);
  expect((await page.request.put("/api/admin/settings", { headers: { origin: new URL(page.url()).origin }, data: {} })).status()).toBe(403);
});

test("unauthenticated settings access redirects to login", async ({ page }) => {
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/settings")).status()).toBe(401);
});

test("a failed save preserves the form, disables duplicate submissions and can be retried", async ({ page }) => {
  await openSettings(page); await fillRequired(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/settings", async (route) => {
    if (route.request().method() !== "PUT") { await route.continue(); return; }
    await gate;
    await route.fulfill({ status: 503, contentType: "text/html", body: "<html>Upstream unavailable</html>" });
  });
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect(page.getByLabel("Clinic name", { exact: true })).toBeDisabled();
  release();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Unable to save clinic settings. Please try again.");
  await expect(page.getByLabel("Clinic name", { exact: true })).toHaveValue("Riverbank Clinic");
  await page.unroute("**/api/admin/settings");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
});

test("copying any day's split hours updates the draft, allows independent edits and persists on save", async ({ page }, testInfo) => {
  await openSettings(page); await fillRequired(page);
  const before = await (await page.request.get("/api/admin/settings")).json();
  const source = page.getByRole("group", { name: "Wednesday hours", exact: true });
  while (await source.getByRole("button", { name: /Remove Wednesday interval/ }).count()) {
    await source.getByRole("button", { name: /Remove Wednesday interval/ }).first().click();
  }
  await page.getByRole("button", { name: "Add Wednesday hours", exact: true }).click();
  await page.getByLabel("Wednesday closing time 1", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "Add Wednesday hours", exact: true }).click();
  await page.getByLabel("Wednesday opening time 2", { exact: true }).fill("14:00");
  await page.getByLabel("Wednesday closing time 2", { exact: true }).fill("18:00");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Copy Wednesday hours to all days", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Wednesday hours copied to all days. Save settings to apply.");
  expect(await (await page.request.get("/api/admin/settings")).json()).toEqual(before);
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    await expect(page.getByLabel(`${day} opening time 1`, { exact: true })).toHaveValue("09:00");
    await expect(page.getByLabel(`${day} closing time 1`, { exact: true })).toHaveValue("12:00");
    await expect(page.getByLabel(`${day} opening time 2`, { exact: true })).toHaveValue("14:00");
    await expect(page.getByLabel(`${day} closing time 2`, { exact: true })).toHaveValue("18:00");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await source.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mobile-copy-hours.png") });
  await page.getByLabel("Monday opening time 1", { exact: true }).fill("10:00");
  await expect(page.getByLabel("Wednesday opening time 1", { exact: true })).toHaveValue("09:00");
  await page.getByRole("button", { name: "Remove Sunday interval 2", exact: true }).click();
  await page.getByRole("button", { name: "Remove Sunday interval 1", exact: true }).click();
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
  await page.reload();
  await expect(page.getByLabel("Monday opening time 1", { exact: true })).toHaveValue("10:00");
  await expect(page.getByLabel("Wednesday opening time 1", { exact: true })).toHaveValue("09:00");
  await expect(page.getByRole("group", { name: "Sunday hours", exact: true }).getByText("Closed", { exact: true })).toBeVisible();
  const persisted = (await (await page.request.get("/api/admin/settings")).json()).settings;
  for (const day of [1, 2, 3, 4, 5]) {
    expect(persisted.weeklyHours[day].intervals).toEqual([{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }]);
  }
});

test("copying a closed day closes the whole week and persists after save", async ({ page }) => {
  await openSettings(page); await fillRequired(page);
  const sunday = page.getByRole("group", { name: "Sunday hours", exact: true });
  while (await sunday.getByRole("button", { name: /Remove Sunday interval/ }).count()) {
    await sunday.getByRole("button", { name: /Remove Sunday interval/ }).first().click();
  }
  if (!(await page.getByLabel("Monday opening time 1", { exact: true }).count())) {
    await page.getByRole("button", { name: "Add Monday hours", exact: true }).click();
  }
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
  await page.getByRole("button", { name: "Copy Sunday hours to all days", exact: true }).click();
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(7);
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Sunday closed day copied to all days. Save settings to apply.");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Clinic settings saved.");
  await page.reload();
  await expect(page.getByText("Closed", { exact: true })).toHaveCount(7);
});
