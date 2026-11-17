import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMetaCancellationSender, createMetaConversationSender, incomingReplies, readConversationMetaConfig, verifyMetaSignature } from "@/modules/notifications/meta-conversation";

const config = { WHATSAPP_ACCESS_TOKEN: "secret-token", WHATSAPP_API_VERSION: "v22.0", WHATSAPP_PHONE_NUMBER_ID: "123456789", WHATSAPP_APP_SECRET: "app-secret", WHATSAPP_VERIFY_TOKEN: "a-verify-token-long-enough" };

describe("Meta WhatsApp conversation adapter", () => {
  it("validates webhook signatures against the raw request body", () => {
    const raw = '{"entry":[]}';
    const signature = `sha256=${createHmac("sha256", config.WHATSAPP_APP_SECRET).update(raw).digest("hex")}`;
    expect(verifyMetaSignature(raw, signature, config.WHATSAPP_APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(raw, signature, "wrong-secret")).toBe(false);
    expect(verifyMetaSignature(raw, null, config.WHATSAPP_APP_SECRET)).toBe(false);
  });
  it("requires opt-in and validates server-only settings without echoing values", () => {
    expect(readConversationMetaConfig({ WHATSAPP_CONVERSATION_ENABLED: "false" })).toBeNull();
    expect(readConversationMetaConfig({ WHATSAPP_CONVERSATION_ENABLED: "true", ...config })).toEqual({ ...config, WHATSAPP_CANCELLATION_TEMPLATE_NAME: "appointment_cancelled", WHATSAPP_CANCELLATION_TEMPLATE_LANGUAGE: "en_US" });
    expect(() => readConversationMetaConfig({ WHATSAPP_CONVERSATION_ENABLED: "true", ...config, WHATSAPP_ACCESS_TOKEN: "bad secret" })).toThrow("Invalid WhatsApp conversation configuration");
  });
  it("extracts unique incoming text and button/list replies while ignoring delivery statuses", () => {
    expect(incomingReplies({ entry: [{ changes: [{ value: { messages: [
      { id: "wamid.1", from: "919876543210", timestamp: "1", type: "text", text: { body: "Hi" } },
      { id: "wamid.2", from: "919876543210", interactive: { type: "button_reply", button_reply: { id: "book" } } },
      { id: "wamid.3", from: "919876543210", interactive: { type: "list_reply", list_reply: { id: "D:2026-11-20" } } },
    ] } }] }] })).toEqual([
      { id: "wamid.1", phone: "+919876543210", text: "Hi" },
      { id: "wamid.2", phone: "+919876543210", text: "book" },
      { id: "wamid.3", phone: "+919876543210", text: "D:2026-11-20" },
    ]);
    expect(incomingReplies({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.4" }] } }] }] })).toEqual([]);
  });
  it("sends recipient-directed buttons and list payloads without exposing credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 }));
    const sender = createMetaConversationSender(readConversationMetaConfig({ WHATSAPP_CONVERSATION_ENABLED: "true", ...config })!, request);
    await sender.send("+919876543210", { type: "buttons", body: "Welcome", buttons: [{ id: "book", title: "Book" }, { id: "support", title: "Support" }] });
    await sender.send("+919876543210", { type: "list", body: "Select a date", button: "Dates", section: "Available", rows: [{ id: "D:2026-11-20", title: "Fri, 20 Nov" }] });
    const requests = request.mock.calls.map(([url, options]) => ({ url, body: JSON.parse(String(options?.body)) }));
    expect(requests[0].body).toMatchObject({ to: "919876543210", type: "interactive", interactive: { type: "button" } });
    expect(requests[1].body).toMatchObject({ to: "919876543210", type: "interactive", interactive: { type: "list" } });
    expect(JSON.stringify(requests)).not.toContain(config.WHATSAPP_ACCESS_TOKEN);
  });
  it("uses the approved cancellation template for the verified patient recipient", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ messages: [{ id: "wamid.synthetic" }] }));
    const sender = createMetaCancellationSender(readConversationMetaConfig({ WHATSAPP_CONVERSATION_ENABLED: "true", ...config })!, request);
    await expect(sender.send({ startsAt: new Date("2026-11-10T09:00:00Z"), timezone: "UTC" }, { to: "+919876543210", event: "appointment_cancelled" })).resolves.toEqual({ status: "accepted", apiMessageId: "wamid.synthetic" });
    const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({ to: "919876543210", type: "template", template: { name: "appointment_cancelled", language: { code: "en_US" }, components: [{ type: "body", parameters: [{ type: "text" }, { type: "text", text: "UTC" }] }] } });
    expect(JSON.stringify(payload)).not.toContain(config.WHATSAPP_ACCESS_TOKEN);
  });
  it("classifies Meta rate limits and temporary failures without exposing response bodies", async () => {
    for (const [status, code] of [[429, "META_RATE_LIMIT"], [503, "META_TEMPORARY_FAILURE"]] as const) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider details", { status }));
      const sender = createMetaConversationSender(readConversationMetaConfig({ WHATSAPP_CONVERSATION_ENABLED: "true", ...config })!, request);
      await expect(sender.send("+919876543210", { type: "text", body: "Hello" })).rejects.toThrow(code);
      expect(String(request.mock.calls[0][1]?.body)).not.toContain(config.WHATSAPP_ACCESS_TOKEN);
    }
  });
});
