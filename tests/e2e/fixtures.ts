import { test as base } from "@playwright/test";
import { Client } from "pg";
export { expect } from "@playwright/test";

export const test = base.extend<{ resetClinic: void }>({
  // Each browser case owns its settings/overrides; never fall back to a developer database URL.
  resetClinic: [async ({}, provide) => {
    const connectionString = process.env.NUVORTIQ_E2E_DATABASE_URL;
    if (!connectionString) throw new Error("Isolated browser database was not configured.");
    const client = new Client({ connectionString });
    try { await client.connect(); await client.query("DELETE FROM clinic_settings WHERE id = 1"); }
    finally { await client.end(); }
    await provide();
  }, { auto: true }],
  baseURL: async ({}, provide) => { await provide(process.env.NUVORTIQ_E2E_URL); },
  // Each case represents a different client; preserve real per-IP attempt limits.
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    const client = [...testInfo.title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 250 + 1;
    await provide({ "x-forwarded-for": `192.0.2.${client}` });
  },
});
