import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { ApplicationDatabase } from "@/db/connection";
import { patientSession, patientUser } from "@/db/schema/auth";
import { whatsappConversations, whatsappWebhookMessages } from "@/db/schema/notifications";
import { readClinicConfiguration } from "@/modules/clinic/repository";
import type { createBookingService } from "@/modules/booking/service";
import type { createSlotAvailabilityService } from "@/modules/scheduling/slots";
import { createWhatsAppConversationVault } from "./conversation-vault";
import type { ConversationMessage, ConversationSender } from "./meta-conversation";

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());
const nameSchema = z.string().trim().min(1).max(100).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
type State = "MAIN_MENU" | "WAITING_FOR_NAME" | "WAITING_FOR_EMAIL" | "WAITING_FOR_CODE" | "SELECTING_DATE" | "SELECTING_SLOT" | "CONFIRMING_BOOKING" | "BOOKING_COMPLETED" | "SUPPORT_REQUESTED";
type Data = { phone: string; name?: string; email?: string; patientUserId?: string; patientSessionId?: string; date?: string; dateNextCursor?: string; startsAt?: string; requestId?: string; slotPage?: number; lastInboundId?: string; lastReply?: ConversationMessage; };
type PatientAuthApi = {
  api: {
    sendVerificationOTP(input: { body: { email: string; type: "sign-in" } }): Promise<unknown>;
    signInEmailOTP(input: { body: { email: string; otp: string; name?: string } }): Promise<{ token: string; user: { id: string; email: string } }>;
  };
};
type BookingService = Pick<ReturnType<typeof createBookingService>, "bookForWhatsApp">;
type Slots = Pick<ReturnType<typeof createSlotAvailabilityService>, "read">;
const DAY_MS = 86_400_000;
const SESSION_MS = 30 * 60_000;

function menu(): ConversationMessage {
  return { type: "buttons", body: "Welcome to Nuvortiq Clinic. What would you like to do?", buttons: [
    { id: "book", title: "Book appointment" }, { id: "support", title: "Contact support" },
  ] };
}
function text(body: string): ConversationMessage { return { type: "text", body }; }
function shortDate(date: string) {
  return new Intl.DateTimeFormat("en", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
}
function shortTime(startsAt: string, timezone: string) {
  return new Intl.DateTimeFormat("en", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(startsAt));
}

export function createWhatsAppConversationService(
  db: ApplicationDatabase,
  booking: BookingService,
  slots: Slots,
  patientAuth: PatientAuthApi,
  sender: ConversationSender,
  encodedKey: string | undefined,
  clock = () => new Date(),
  uuid = () => crypto.randomUUID(),
) {
  const vault = createWhatsAppConversationVault(encodedKey);

  async function dateChoices(startDate?: string) {
    const first = await slots.read(startDate);
    if (!first.configured || first.noAvailableDates) return { first, days: [] as { date: string; available: number }[] };
    const days: { date: string; available: number }[] = [];
    let cursor = Date.parse(`${startDate ?? first.today}T00:00:00Z`);
    for (; cursor <= Date.parse(`${first.lastDate}T00:00:00Z`) && days.length < 8; cursor += DAY_MS) {
      const date = new Date(cursor).toISOString().slice(0, 10);
      const view = await slots.read(date), available = view.slots.filter((slot) => slot.availability === "available").length;
      if (available) days.push({ date, available });
    }
    return { first, days, nextCursor: cursor <= Date.parse(`${first.lastDate}T00:00:00Z`) ? new Date(cursor).toISOString().slice(0, 10) : undefined };
  }

  function datesMessage(days: { date: string; available: number }[], nextCursor?: string): ConversationMessage {
    const rows: { id: string; title: string; description?: string }[] = days.map(({ date, available }) => ({ id: `D:${date}`, title: shortDate(date), description: `${available} available time${available === 1 ? "" : "s"}` }));
    if (nextCursor) rows.push({ id: `D:MORE:${nextCursor}`, title: "More dates" });
    return { type: "list", body: "Choose an available date, or send Cancel to return to the main menu.", button: "View dates", section: "Available dates", rows };
  }

  function timesMessage(date: string, timezone: string, available: { startsAt: string; label: string }[], page: number): ConversationMessage {
    const start = page * 8, rows = available.slice(start, start + 8).map((slot) => ({ id: `S:${slot.startsAt}`, title: slot.label }));
    if (page > 0) rows.unshift({ id: "S:PREVIOUS", title: "Previous times" });
    if (start + 8 < available.length) rows.push({ id: "S:MORE", title: "More times" });
    return { type: "list", body: `Choose a time on ${shortDate(date)} (${timezone}), or send Cancel to return to the main menu.`, button: "View times", section: "Available times", rows };
  }

  async function process(phone: string, messageId: string, incoming: string): Promise<{ state: State; data: Data; reply: ConversationMessage } | null> {
    const senderHash = vault.senderHash(phone), now = clock();
    const existing = await db.transaction(async (tx) => {
      await tx.insert(whatsappConversations).values({ senderHash, state: "MAIN_MENU", payloadCiphertext: vault.encrypt(senderHash, { phone } satisfies Data), expiresAt: new Date(now.getTime() + SESSION_MS), updatedAt: now }).onConflictDoNothing();
      const accepted = await tx.insert(whatsappWebhookMessages).values({ messageId, receivedAt: now }).onConflictDoNothing().returning({ messageId: whatsappWebhookMessages.messageId });
      const [row] = await tx.select().from(whatsappConversations).where(eq(whatsappConversations.senderHash, senderHash)).for("update");
      const data = row ? vault.decrypt<Data>(senderHash, row.payloadCiphertext) : { phone };
      if (!accepted.length) return { duplicate: true as const, state: (row?.state ?? "MAIN_MENU") as State, data };
      if (row && row.expiresAt <= now && row.state !== "BOOKING_COMPLETED") return { duplicate: false as const, state: "MAIN_MENU" as State, data: { phone } };
      return { duplicate: false as const, state: (row?.state ?? "MAIN_MENU") as State, data };
    });

    if (existing.duplicate) {
      if (existing.data.lastInboundId === messageId && existing.data.lastReply) {
        try { await sender.send(phone, existing.data.lastReply); }
        catch { throw new Error("WHATSAPP_REPLY_FAILED"); }
      }
      return null;
    }
    let { state, data } = existing;
    const normalized = incoming.trim(), command = normalized.toLowerCase();
    let reply: ConversationMessage;
    if (["cancel", "restart", "menu", "start over"].includes(command) || normalized === "cancel_booking") {
      state = "MAIN_MENU"; data = { phone }; reply = menu();
    } else if (state === "MAIN_MENU") {
      if (command === "hi" || command === "hello" || command === "hey" || command === "menu" || command === "start") reply = menu();
      else if (normalized === "book" || normalized === "book_appointment") { state = "WAITING_FOR_NAME"; reply = text("What name should we use for your appointment? Send Cancel to return to the main menu."); }
      else if (normalized === "support" || normalized === "contact_support") {
        const clinic = await readClinicConfiguration(db);
        const methods = [clinic?.phone ? `Phone: ${clinic.phone}` : "", clinic?.email ? `Email: ${clinic.email}` : ""].filter(Boolean).join("\n");
        state = "SUPPORT_REQUESTED"; reply = { type: "buttons", body: methods ? `Please contact the clinic team:\n${methods}` : "The clinic has not configured its phone or email contact yet. Please try again later.", buttons: [{ id: "book", title: "Book appointment" }, { id: "menu", title: "Main menu" }] };
      } else reply = menu();
    } else if (state === "SUPPORT_REQUESTED") {
      if (normalized === "book" || normalized === "book_appointment") { state = "WAITING_FOR_NAME"; data = { phone }; reply = text("What name should we use for your appointment? Send Cancel to return to the main menu."); }
      else { state = "MAIN_MENU"; data = { phone }; reply = menu(); }
    } else if (state === "WAITING_FOR_NAME") {
      const name = nameSchema.safeParse(normalized);
      if (!name.success) reply = text("Please enter your name (up to 100 characters).");
      else { data.name = name.data; state = "WAITING_FOR_EMAIL"; reply = text("What is your email address? We’ll send a one-time verification code before showing available times. Send Cancel to stop."); }
    } else if (state === "WAITING_FOR_EMAIL") {
      const email = emailSchema.safeParse(normalized);
      if (!email.success) reply = text("Please enter a valid email address.");
      else {
        try {
          await patientAuth.api.sendVerificationOTP({ body: { email: email.data, type: "sign-in" } });
          data.email = email.data; state = "WAITING_FOR_CODE"; reply = text("A verification code was sent to that email. Enter it here; it expires in five minutes. Send Cancel to stop.");
        } catch { reply = text("Email verification is temporarily unavailable. Please try again later or contact the clinic."); }
      }
    } else if (state === "WAITING_FOR_CODE") {
      if (!data.email || !/^\d{4,6}$/.test(normalized)) reply = text("Enter the verification code from your email, or send Cancel to start over.");
      else {
        try {
          const result = await patientAuth.api.signInEmailOTP({ body: { email: data.email, otp: normalized, name: data.name } });
          const [session] = await db.select({ id: patientSession.id, userId: patientSession.userId }).from(patientSession).innerJoin(patientUser, eq(patientUser.id, patientSession.userId))
            .where(and(eq(patientSession.token, result.token), eq(patientSession.userId, result.user.id), eq(patientUser.emailVerified, true), gt(patientSession.expiresAt, now))).limit(1);
          if (!session) throw new Error("Verified session could not be confirmed.");
          data.patientUserId = session.userId; data.patientSessionId = session.id; state = "SELECTING_DATE";
          const choices = await dateChoices();
          data.dateNextCursor = choices.nextCursor;
          reply = choices.days.length ? datesMessage(choices.days, choices.nextCursor) : text("There are no available appointment times right now. Send Cancel to return to the main menu.");
        } catch { reply = text("That code is invalid or expired. Request a new one by sending your email again, or send Cancel to start over."); state = "WAITING_FOR_EMAIL"; }
      }
    } else if (state === "SELECTING_DATE") {
      if (normalized.startsWith("D:MORE:")) {
        const cursor = normalized.slice("D:MORE:".length), choices = await dateChoices(cursor);
        data.dateNextCursor = choices.nextCursor;
        reply = choices.days.length ? datesMessage(choices.days, choices.nextCursor) : text("There are no more available dates. Send Cancel to return to the main menu.");
      } else {
      const date = normalized.startsWith("D:") ? normalized.slice(2) : "";
      const view = date ? await slots.read(date).catch(() => null) : null;
      const available = view?.slots.filter((slot) => slot.availability === "available") ?? [];
      if (!view || !available.length) {
        const choices = await dateChoices(); data.dateNextCursor = choices.nextCursor; reply = choices.days.length ? datesMessage(choices.days, choices.nextCursor) : text("No appointment times are currently available. Send Cancel to return to the main menu.");
      } else {
        data.date = date; data.slotPage = 0; state = "SELECTING_SLOT";
        reply = timesMessage(date, view.timezone, available, 0);
      }
      }
    } else if (state === "SELECTING_SLOT") {
      if (normalized === "S:MORE" || normalized === "S:PREVIOUS") {
        const view = data.date ? await slots.read(data.date).catch(() => null) : null;
        const available = view?.slots.filter((choice) => choice.availability === "available") ?? [];
        const page = Math.max(0, (data.slotPage ?? 0) + (normalized === "S:MORE" ? 1 : -1)); data.slotPage = page;
        reply = view && data.date ? timesMessage(data.date, view.timezone, available, page) : text("Please choose an available date again.");
      } else {
      const startsAt = normalized.startsWith("S:") ? normalized.slice(2) : "";
      const view = data.date ? await slots.read(data.date).catch(() => null) : null;
      const slot = view?.slots.find((choice) => choice.startsAt === startsAt && choice.availability === "available");
      if (!slot || !view || !data.name || !data.email || !data.patientSessionId || !data.patientUserId) {
        state = "SELECTING_DATE"; const choices = await dateChoices(); data.dateNextCursor = choices.nextCursor; reply = choices.days.length ? datesMessage(choices.days, choices.nextCursor) : text("No appointment times are currently available.");
      } else {
        data.startsAt = slot.startsAt; data.requestId = uuid(); state = "CONFIRMING_BOOKING";
        reply = { type: "buttons", body: `Appointment summary\nName: ${data.name}\nDate and time: ${shortTime(slot.startsAt, view.timezone)} (${view.timezone})\n\nChoose whether to receive WhatsApp appointment updates.`, buttons: [
          { id: "confirm_updates", title: "Confirm + updates" }, { id: "confirm_no_updates", title: "Confirm only" }, { id: "cancel_booking", title: "Cancel" },
        ] };
      }
      }
    } else if (state === "CONFIRMING_BOOKING") {
      if (normalized === "confirm_updates" || normalized === "confirm_no_updates") {
        if (!data.patientUserId || !data.patientSessionId || !data.requestId || !data.startsAt || !data.name) { state = "MAIN_MENU"; data = { phone }; reply = menu(); }
        else {
          try {
            const receipt = await booking.bookForWhatsApp({ userId: data.patientUserId, sessionId: data.patientSessionId }, {
              requestId: data.requestId, startsAt: data.startsAt, name: data.name, phone, whatsappConsent: normalized === "confirm_updates",
            });
            state = "BOOKING_COMPLETED";
            reply = { type: "buttons", body: `Your appointment is confirmed for ${shortTime(receipt.startsAt, receipt.timezone)} (${receipt.timezone}). Reference: ${receipt.id.slice(0, 8)}.`, buttons: [{ id: "book", title: "Book another" }, { id: "support", title: "Contact support" }] };
          } catch {
            state = "SELECTING_DATE"; const choices = await dateChoices();
            reply = choices.days.length ? text("That time is no longer available. Please choose another date.") : text("We could not confirm that time and no other times are available. Please contact the clinic.");
          }
        }
      } else reply = text("Choose Confirm + updates, Confirm only, or Cancel.");
    } else if (state === "BOOKING_COMPLETED") {
      if (normalized === "book" || normalized === "book_appointment") { state = "WAITING_FOR_NAME"; data = { phone }; reply = text("What name should we use for your appointment? Send Cancel to return to the main menu."); }
      else if (normalized === "support" || normalized === "contact_support") { state = "MAIN_MENU"; data = { phone }; reply = menu(); }
      else reply = text("Your booking is complete. Send Book to start another booking, or Support for clinic contact details.");
    } else { state = "MAIN_MENU"; data = { phone }; reply = menu(); }

    data.lastInboundId = messageId; data.lastReply = reply;
    const updatedAt = clock();
    await db.insert(whatsappConversations).values({ senderHash, state, payloadCiphertext: vault.encrypt(senderHash, data), expiresAt: new Date(updatedAt.getTime() + SESSION_MS), updatedAt })
      .onConflictDoUpdate({ target: whatsappConversations.senderHash, set: { state, payloadCiphertext: vault.encrypt(senderHash, data), expiresAt: new Date(updatedAt.getTime() + SESSION_MS), updatedAt } });
    try { await sender.send(phone, reply); }
    catch (error) {
      const code = error instanceof Error && /^META_[A-Z_]+$/.test(error.message) ? error.message : "META_SEND_FAILED";
      console.warn(`WhatsApp conversation reply could not be sent; sender=${senderHash.slice(0, 12)} code=${code}`);
      throw new Error("WHATSAPP_REPLY_FAILED");
    }
    return { state, data, reply };
  }

  return { process };
}
