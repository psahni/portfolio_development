import { test, expect } from "./fixtures";

test("home links to the two-field login and Send code validates only email", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Clinic sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("input")).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("desktop-login.png"), fullPage: true });
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Enter a valid email address.");
  await page.getByLabel("Email", { exact: true }).fill("staff@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code", { exact: true })).toBeFocused();
  await expect(page.locator("input")).toHaveCount(1);
  await page.getByRole("button", { name: "Use another email" }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("staff@example.test");
  await expect(page.getByLabel("PIN", { exact: true })).toHaveValue("");
});

test("admin signs in with the real PIN and signs out of the protected workspace", async ({ page, context }) => {
  await page.goto("/admin/workspace");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test");
  await page.getByLabel("PIN", { exact: true }).fill("4821");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
  await expect(page.getByText("Doctor / Admin", { exact: true })).toBeVisible();
  expect((await context.cookies()).find((cookie) => cookie.name === "nuvortiq-staff.session_token")?.httpOnly).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/workspace");
  await expect(page).toHaveURL(/\/admin$/);
});

test("staff PIN is rejected; code login retains email and never sends a PIN", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("staff@example.test");
  await page.getByLabel("PIN", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Unable to sign in. Check your details and try again.");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.locator("input")).toHaveCount(1);
  await page.getByLabel("Code", { exact: true }).fill("0000");
  const submitted = page.waitForRequest((request) => request.url().endsWith("/sign-in/email-otp"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  expect((await submitted).postDataJSON()).toEqual({ email: "staff@example.test", otp: "0000" });
  await expect(page.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
  await expect(page.getByText("Staff", { exact: true })).toBeVisible();
});

test("unknown emails receive the same code step but cannot sign in", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("unknown@example.test");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code", { exact: true })).toBeVisible();
  await page.getByLabel("Code", { exact: true }).fill("0000");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);
});

test("failed requests show an error, allow retry and prevent duplicate submissions", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("staff@example.test");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/auth/staff/email-otp/send-verification-otp", async (route) => {
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Sign-in is temporarily unavailable. Please try again." }) });
  });
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("button", { name: "Sending code…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeDisabled();
  release();
  await expect(page.locator("form").getByRole("alert")).toHaveText("Sign-in is temporarily unavailable. Please try again.");
  await page.unroute("**/api/auth/staff/email-otp/send-verification-otp");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("Code", { exact: true })).toBeVisible();
});

test("mobile login fits the viewport and supports keyboard submission", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-login.png"), fullPage: true });
  await page.getByLabel("Email", { exact: true }).fill("doctor@example.test");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("PIN", { exact: true })).toBeFocused();
  await page.keyboard.type("0000");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Clinic workspace" })).toBeVisible();
});
