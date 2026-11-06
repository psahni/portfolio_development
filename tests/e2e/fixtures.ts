import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";

export const test = base.extend({
  baseURL: async ({}, provide) => { await provide(process.env.NUVORTIQ_E2E_URL); },
  // Each case represents a different client; preserve real per-IP attempt limits.
  extraHTTPHeaders: async ({}, provide, testInfo) => {
    const client = [...testInfo.title].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 250 + 1;
    await provide({ "x-forwarded-for": `192.0.2.${client}` });
  },
});
