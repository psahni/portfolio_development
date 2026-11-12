import "server-only";
import { z } from "zod";

const configSchema = z.object({
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).refine((v) => !/\s/.test(v)),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d+\.0$/),
  WHATSAPP_TEST_PHONE_NUMBER_ID: z.string().regex(/^\d+$/),
  WHATSAPP_TEST_RECIPIENT: z.string().regex(/^\+[1-9]\d{6,14}$/),
  WHATSAPP_TEMPLATE_NAME: z.string().regex(/^[a-z0-9_]+$/),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  // hello_world needs no parameters; an appointment template can take time + timezone.
  WHATSAPP_TEMPLATE_MODE: z.enum(["no_parameters", "appointment"]).default("no_parameters"),
});
export type MetaConfig = z.infer<typeof configSchema>;
export function readWhatsAppConfig(source: Record<string, string | undefined> = process.env): MetaConfig | null {
  if (source.WHATSAPP_ENABLED === undefined || source.WHATSAPP_ENABLED === "false") return null;
  if (source.WHATSAPP_ENABLED !== "true" || source.NODE_ENV === "production" || process.env.NODE_ENV === "production") throw new Error("WhatsApp Phase 1 requires explicit test-only configuration.");
  const result = configSchema.safeParse(source);
  // Never include Zod input values or provider error bodies in diagnostics.
  if (!result.success) throw new Error("Invalid WhatsApp test configuration. See .env.example.");
  return result.data;
}
export type SendResult = { status: "accepted" | "failed" | "uncertain"; apiMessageId?: string; errorCode?: string; retryable?: boolean };
export type WhatsAppSender = { send(visit: { startsAt: Date; timezone: string }): Promise<SendResult> };

export function isWhatsAppWorkerEnabled(source: Record<string, string | undefined> = process.env): boolean {
  const flag = source.WHATSAPP_USE_WORKER ?? "true";
  if (flag !== "true" && flag !== "false") throw new Error("WHATSAPP_USE_WORKER must be true or false.");
  return flag === "true";
}

export function createMetaWhatsApp(config: MetaConfig, request: typeof fetch = fetch, timeoutMs = 15_000): WhatsAppSender {
  return { async send(visit) {
    const template: { name: string; language: { code: string }; components?: object[] } = { name: config.WHATSAPP_TEMPLATE_NAME, language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE } };
    if (config.WHATSAPP_TEMPLATE_MODE === "appointment") template.components = [{ type: "body", parameters: [
      { type: "text", text: new Intl.DateTimeFormat("en-GB", { timeZone: visit.timezone, dateStyle: "medium", timeStyle: "short" }).format(visit.startsAt) },
      { type: "text", text: visit.timezone },
    ] }];
    try {
      const response = await request(`https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_TEST_PHONE_NUMBER_ID}/messages`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: config.WHATSAPP_TEST_RECIPIENT.slice(1), type: "template", template }),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.ok) {
        const parsed = z.object({ messages: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9._=+\/-]{1,512}$/) })).min(1) }).safeParse(data);
        return parsed.success ? { status: "accepted", apiMessageId: parsed.data.messages[0].id } : { status: "uncertain", errorCode: "INVALID_RESPONSE" };
      }
      const parsed = z.object({ error: z.object({ code: z.number().int().nonnegative() }) }).safeParse(data);
      const errorCode = parsed.success ? `META_${parsed.data.error.code}` : `HTTP_${response.status}`;
      // Only an explicit rate-limit rejection is automatically retried. A timeout/5xx
      // may hide an accepted send; Meta supplies no exactly-once send guarantee here.
      return response.status >= 400 && response.status < 500
        ? { status: "failed", errorCode, retryable: response.status === 429 }
        : { status: "uncertain", errorCode };
    } catch { return { status: "uncertain", errorCode: "NETWORK_OR_TIMEOUT" }; }
  } };
}
