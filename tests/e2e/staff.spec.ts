import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

async function adminLogin(page: Page) {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test");
  await page.getByLabel("PIN", { exact: true }).fill("4821");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
}

async function staffLogin(page: Page, email: string) {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("admin adds staff, rejects duplicate email, disables existing access and re-enables fresh code login", async ({ page, browser, baseURL, extraHTTPHeaders }) => {
  const email = "staff-journey@example.test";
  await adminLogin(page);
  await page.getByRole("link", { name: "Staff navigation" }).click();
  await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Journey Receptionist");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Staff member added");
  const member = page.getByRole("listitem").filter({ hasText: email });
  await expect(member.getByText("Active", { exact: true })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Duplicate Receptionist");
  await page.getByLabel("Email", { exact: true }).fill(email.toUpperCase());
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("A clinic account already uses this email address.");
  await expect(member).toHaveCount(1);

  const staffContext = await browser.newContext({ baseURL, extraHTTPHeaders });
  try {
    const staff = await staffContext.newPage();
    await staffLogin(staff, email);
    await expect(staff.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
    await expect(staff.getByRole("link", { name: "Staff navigation" })).toHaveCount(0);
    await staff.goto("/admin/staff");
    await expect(staff).toHaveURL(/\/admin\/workspace$/);
    expect((await staff.request.get("/api/admin/staff")).status()).toBe(403);
    expect((await staff.request.post("/api/admin/staff", { headers: { origin: baseURL! }, data: { name: "Forged", email: "forged-staff@example.test" } })).status()).toBe(403);

    await member.getByRole("button", { name: "Disable access for Journey Receptionist" }).click();
    await member.getByRole("button", { name: "Keep access" }).click();
    await expect(member.getByText("Active", { exact: true })).toBeVisible();
    await member.getByRole("button", { name: "Disable access for Journey Receptionist" }).click();
    await member.getByRole("button", { name: "Confirm disable" }).click();
    await expect(member.getByText("Inactive", { exact: true })).toBeVisible();
    await staff.goto("/admin/workspace");
    await expect(staff).toHaveURL(/\/admin$/);
    await staffLogin(staff, email);
    await expect(staff.locator("form").getByRole("alert")).toBeVisible();

    await member.getByRole("button", { name: "Enable access for Journey Receptionist" }).click();
    await expect(member.getByText("Active", { exact: true })).toBeVisible();
    await staff.goto("/admin/workspace");
    await expect(staff).toHaveURL(/\/admin$/);
    await staffLogin(staff, email);
    await expect(staff.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
    await page.reload();
    await expect(member.getByText("Active", { exact: true })).toBeVisible();
  } finally { await staffContext.close(); }
});

test("staff page handles mobile validation, pending creation, failure and retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await adminLogin(page);
  await page.goto("/admin/staff");
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Enter the staff member’s name.");
  await page.getByLabel("Name", { exact: true }).fill("Mobile Receptionist");
  await page.getByLabel("Email", { exact: true }).fill("staff-mobile@example.test");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/admin/staff", async (route) => {
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Staff management is temporarily unavailable. Please try again." }) });
  });
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add staff", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh list" })).toBeDisabled();
  release();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Staff management is temporarily unavailable. Please try again.");
  await page.unroute("**/api/admin/staff");
  await page.getByRole("button", { name: "Add staff", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Staff member added");
  await page.getByRole("button", { name: "Refresh list" }).click();
  await expect(page.getByRole("status")).toHaveText("Staff list refreshed.");
  await expect(page.getByText("staff-mobile@example.test", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("anonymous and patient sessions cannot open staff management", async ({ page }) => {
  await page.goto("/admin/staff");
  await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/staff")).status()).toBe(401);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/appointments$/);
  await page.goto("/admin/staff");
  await expect(page).toHaveURL(/\/admin$/);
  expect((await page.request.get("/api/admin/staff")).status()).toBe(401);
});
