import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SendResult, WhatsAppSender } from "./meta";

const configSchema = z.object({
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).refine((value) => !/\s/.test(value)),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.0$/),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(16),
  WHATSAPP_CANCELLATION_TEMPLATE_NAME: z.string().regex(/^[a-z0-9_]+$/).default("appointment_cancelled"),
  WHATSAPP_CANCELLATION_TEMPLATE_LANGUAGE: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/).default("en_US"),
});
export type ConversationMetaConfig = z.infer<typeof configSchema>;

export function readConversationMetaConfig(source: Record<string, string | undefined> = process.env): ConversationMetaConfig | null {
  if (source.WHATSAPP_CONVERSATION_ENABLED !== "true") return null;
  const parsed = configSchema.safeParse(source);
  if (!parsed.success) throw new Error("Invalid WhatsApp conversation configuration. See .env.example.");
  return parsed.data;
}

export function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(signature.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export type ConversationMessage =
  | { type: "text"; body: string }
  | { type: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | { type: "list"; body: string; button: string; section: string; rows: { id: string; title: string; description?: string }[] };

export type ConversationSender = { send(to: string, message: ConversationMessage): Promise<void> };

export function createMetaConversationSender(config: ConversationMetaConfig, request: typeof fetch = fetch, timeoutMs = 8_000): ConversationSender {
  return { async send(to, message) {
    const interactive = message.type === "buttons" ? {
      type: "button", body: { text: message.body }, action: { buttons: message.buttons.slice(0, 3).map((button) => ({ type: "reply", reply: button })) },
    } : message.type === "list" ? {
      type: "list", body: { text: message.body }, action: { button: message.button, sections: [{ title: message.section, rows: message.rows.slice(0, 10) }] },
    } : undefined;
    const payload = message.type === "text"
      ? { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body: message.body } }
      : { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "interactive", interactive };
    const response = await request(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "META_RATE_LIMIT" : response.status >= 500 ? "META_TEMPORARY_FAILURE" : "META_REJECTED_MESSAGE");
  } };
}

export function createMetaCancellationSender(config: ConversationMetaConfig, request: typeof fetch = fetch, timeoutMs = 8_000): WhatsAppSender {
  return { async send(visit, destination): Promise<SendResult> {
    if (!destination || destination.event !== "appointment_cancelled") return { status: "failed", errorCode: "UNSUPPORTED_NOTIFICATION_EVENT" };
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: visit.timezone, dateStyle: "medium", timeStyle: "short" }).format(visit.startsAt);
    try {
      const response = await request(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: destination.to.replace(/^\+/, ""), type: "template", template: {
          name: config.WHATSAPP_CANCELLATION_TEMPLATE_NAME, language: { code: config.WHATSAPP_CANCELLATION_TEMPLATE_LANGUAGE },
          components: [{ type: "body", parameters: [{ type: "text", text: when }, { type: "text", text: visit.timezone }] }],
        } }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const parsed = z.object({ messages: z.array(z.object({ id: z.string().min(1).max(512) })).min(1) }).safeParse(data);
        return parsed.success ? { status: "accepted", apiMessageId: parsed.data.messages[0].id } : { status: "uncertain", errorCode: "INVALID_RESPONSE" };
      }
      const parsed = z.object({ error: z.object({ code: z.number().int().nonnegative() }) }).safeParse(data);
      const errorCode = parsed.success ? `META_${parsed.data.error.code}` : `HTTP_${response.status}`;
      return response.status >= 400 && response.status < 500
        ? { status: "failed", errorCode, retryable: response.status === 429 }
        : { status: "uncertain", errorCode };
    } catch { return { status: "uncertain", errorCode: "NETWORK_OR_TIMEOUT" }; }
  } };
}

export const metaWebhookEnvelope = z.object({
  entry: z.array(z.object({ changes: z.array(z.object({ value: z.object({
    messages: z.array(z.object({
      id: z.string().min(1).max(512), from: z.string().regex(/^\d{7,15}$/),
      text: z.object({ body: z.string().max(4096) }).optional(),
      interactive: z.object({ button_reply: z.object({ id: z.string().max(256) }).optional(), list_reply: z.object({ id: z.string().max(256) }).optional() }).optional(),
    }).passthrough()).optional(),
  }).passthrough() }).passthrough()) }).passthrough()) }).passthrough();

export function incomingReplies(payload: unknown) {
  const parsed = metaWebhookEnvelope.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.entry.flatMap((entry) => entry.changes.flatMap((change) => change.value.messages ?? [])).map((message) => ({
    id: message.id, phone: `+${message.from}`, text: message.text?.body ?? message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id ?? "",
  })).filter((message) => message.text.trim().length > 0);
}
