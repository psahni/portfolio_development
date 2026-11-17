import { readConversationMetaConfig, verifyMetaSignature, incomingReplies } from "@/modules/notifications/meta-conversation";
import { getWhatsAppConversationService } from "@/modules/notifications/conversation-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const config = readConversationMetaConfig();
  if (!config) return new Response("Webhook is disabled.", { status: 404 });
  const query = new URL(request.url).searchParams;
  if (query.get("hub.mode") !== "subscribe" || query.get("hub.verify_token") !== config.WHATSAPP_VERIFY_TOKEN) return new Response("Forbidden", { status: 403 });
  return new Response(query.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  const config = readConversationMetaConfig();
  if (!config) return Response.json({ error: "Webhook disabled." }, { status: 404 });
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), config.WHATSAPP_APP_SECRET)) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return Response.json({ error: "Invalid webhook payload." }, { status: 400 }); }
  const messages = incomingReplies(payload);
  if (!messages.length) return Response.json({ success: true });
  try {
    const service = getWhatsAppConversationService();
    if (!service) return Response.json({ error: "Webhook disabled." }, { status: 404 });
    for (const message of messages) await service.process(message.phone, message.id, message.text);
    return Response.json({ success: true });
  } catch {
    console.warn("WhatsApp webhook processing failed (PROCESSING_ERROR).");
    return Response.json({ error: "Webhook processing failed." }, { status: 503 });
  }
}
