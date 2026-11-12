import { createPostBookingWhatsApp } from "@/modules/notifications/post-booking";
import { createPatientBookingHandler } from "@/modules/booking/hosted-http";
import type { BookingReceipt } from "@/modules/booking/models";
import { describe, expect, it, vi } from "vitest";
import { createMetaWhatsApp, readWhatsAppConfig, isWhatsAppWorkerEnabled } from "@/modules/notifications/meta";

const env = { WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "private-test-token", WHATSAPP_API_VERSION: "v23.0", WHATSAPP_TEST_PHONE_NUMBER_ID: "123456", WHATSAPP_TEST_RECIPIENT: "+919876543210", WHATSAPP_TEMPLATE_NAME: "hello_world", WHATSAPP_TEMPLATE_LANGUAGE: "en_US" };
const visit = { startsAt: new Date("2026-11-14T09:00:00Z"), timezone: "Asia/Kolkata" };
describe("Meta test adapter", () => {
  it("is disabled by default, validates configuration without values and rejects production", () => {
    expect(readWhatsAppConfig({})).toBeNull();
    expect(readWhatsAppConfig({ ...env, WHATSAPP_ENABLED: "false" })).toBeNull();
    expect(() => readWhatsAppConfig({ ...env, NODE_ENV: "production" })).toThrow(/test-only/);
    expect(() => readWhatsAppConfig({ ...env, WHATSAPP_ENABLED: "yes" })).toThrow(/test-only/);
    for (const field of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_API_VERSION", "WHATSAPP_TEST_PHONE_NUMBER_ID", "WHATSAPP_TEST_RECIPIENT", "WHATSAPP_TEMPLATE_NAME"]) {
      expect(() => readWhatsAppConfig({ ...env, [field]: "private invalid value" })).toThrow("Invalid WhatsApp test configuration. See .env.example.");
    }
  });
  it("sends a template only to the configured recipient, without appointment contacts", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages: [{ id: "wamid.synthetic" }] }));
    const result = await createMetaWhatsApp(readWhatsAppConfig(env)!, request).send(visit);
    expect(result).toEqual({ status: "accepted", apiMessageId: "wamid.synthetic" });
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v23.0/123456/messages");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer private-test-token" });
    expect(JSON.parse(String(options?.body))).toEqual({ messaging_product: "whatsapp", to: "919876543210", type: "template", template: { name: "hello_world", language: { code: "en_US" } } });
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(env.WHATSAPP_ACCESS_TOKEN);
  });
  it("supports an appointment template with local time and timezone parameters", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages: [{ id: "wamid.appointment" }] }));
    await createMetaWhatsApp(readWhatsAppConfig({ ...env, WHATSAPP_TEMPLATE_MODE: "appointment" })!, request).send(visit);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).template.components[0].parameters).toEqual([{ type: "text", text: "14 Nov 2026, 14:30" }, { type: "text", text: "Asia/Kolkata" }]);
  });
  it.each([400, 401, 429, 500, 503])("records only safe error codes for HTTP %s", async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 190, message: env.WHATSAPP_ACCESS_TOKEN, error_data: { details: "private patient" } } }, { status }));
    const result = await createMetaWhatsApp(readWhatsAppConfig(env)!, request).send(visit);
    expect(result).toEqual(status < 500 ? { status: "failed", errorCode: "META_190", retryable: status === 429 } : { status: "uncertain", errorCode: "META_190" });
  });
  it("does not resend on timeouts, malformed responses or redirect failures", async () => {
    for (const response of [Response.json({}), new Response("private response"), Response.json({ error: { code: "private" } }, { status: 403 })]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(response);
      const result = await createMetaWhatsApp(readWhatsAppConfig(env)!, request).send(visit);
      expect(result).toEqual(response.status === 403 ? { status: "failed", errorCode: "HTTP_403", retryable: false } : { status: "uncertain", errorCode: "INVALID_RESPONSE" });
      expect(request).toHaveBeenCalledTimes(1);
    }
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(env.WHATSAPP_ACCESS_TOKEN));
    expect(await createMetaWhatsApp(readWhatsAppConfig(env)!, request).send(visit)).toEqual({ status: "uncertain", errorCode: "NETWORK_OR_TIMEOUT" });
  });
});


describe("WhatsApp delivery mode", () => {
  const receipt: BookingReceipt = { id: "00000000-0000-4000-8000-000000000001", status: "confirmed", startsAt: "2026-11-14T09:00:00Z", endsAt: "2026-11-14T09:20:00Z", timezone: "UTC", durationMinutes: 20, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
  it("defaults to worker mode and validates explicit flags", () => {
    expect(isWhatsAppWorkerEnabled({})).toBe(true);
    expect(isWhatsAppWorkerEnabled({ WHATSAPP_USE_WORKER: "true" })).toBe(true);
    expect(isWhatsAppWorkerEnabled({ WHATSAPP_USE_WORKER: "false" })).toBe(false);
    expect(() => isWhatsAppWorkerEnabled({ WHATSAPP_USE_WORKER: "ON" })).toThrow("WHATSAPP_USE_WORKER must be true or false.");
  });
  it("skips database and Meta in worker mode or when disabled", async () => {
    const db = vi.fn(), sender = vi.fn(), report = vi.fn();
    for (const source of [{ ...env }, { WHATSAPP_USE_WORKER: "false", WHATSAPP_ENABLED: "false" }]) {
      await createPostBookingWhatsApp(db, source, sender, report)(receipt);
    }
    expect(db).not.toHaveBeenCalled(); expect(sender).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
  });
  it("logs configuration failures safely without rejecting the successful booking", async () => {
    const db = vi.fn(), sender = vi.fn(), report = vi.fn();
    await expect(createPostBookingWhatsApp(db, { ...env, WHATSAPP_USE_WORKER: "false", WHATSAPP_API_VERSION: "private-invalid-token" }, sender, report)(receipt)).resolves.toBeUndefined();
    expect(db).not.toHaveBeenCalled(); expect(sender).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith({ appointmentId: receipt.id, status: "uncertain", code: "REQUEST_DELIVERY_FAILED" });
    expect(JSON.stringify(report.mock.calls)).not.toContain("private-invalid-token");
  });
  it("returns the committed receipt even when the post-confirmation callback throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const bookPatient = vi.fn(async () => receipt), after = vi.fn(async () => { throw new Error("private-token"); });
      const handler = createPatientBookingHandler(() => ({ bookPatient, bookForClinic: vi.fn() }), () => "http://localhost:3000", after);
      const response = await handler(new Request("http://localhost:3000/api/patient/bookings", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}" }));
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ receipt });
      expect(after).toHaveBeenCalledWith(receipt); expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private-token");
    } finally { warn.mockRestore(); }
  });
  it("aborts a slow Meta request and reports an uncertain timeout without resending", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new Error("private-token")), { once: true });
    }));
    const result = await createMetaWhatsApp(readWhatsAppConfig(env)!, request, 20).send(visit);
    expect(result).toEqual({ status: "uncertain", errorCode: "NETWORK_OR_TIMEOUT" });
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
