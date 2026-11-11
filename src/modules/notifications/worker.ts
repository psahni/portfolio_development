import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { ApplicationDatabase } from "@/db/connection";
import { appointments } from "@/db/schema/booking";
import { whatsappAttempts, whatsappConsents, whatsappNotifications } from "@/db/schema/notifications";
import type { SendResult, WhatsAppSender } from "./meta";

export function createWhatsAppWorker(db: ApplicationDatabase, sender: WhatsAppSender, clock = () => new Date()) {
  async function runOnce(): Promise<boolean> {
    const now = clock();
    // A crashed process may have sent successfully. Never automatically resend its job.
    await db.transaction(async (tx) => {
      const stale = await tx.select().from(whatsappNotifications).where(and(eq(whatsappNotifications.status, "sending"), lte(whatsappNotifications.updatedAt, new Date(now.getTime() - 60_000)))).for("update", { skipLocked: true });
      for (const job of stale) {
        await tx.update(whatsappNotifications).set({ status: "uncertain", errorCode: "WORKER_INTERRUPTED", updatedAt: now }).where(eq(whatsappNotifications.id, job.id));
        await tx.update(whatsappAttempts).set({ status: "uncertain", errorCode: "WORKER_INTERRUPTED", finishedAt: now }).where(and(eq(whatsappAttempts.notificationId, job.id), eq(whatsappAttempts.number, job.attempts)));
      }
    });
    const claimed = await db.transaction(async (tx) => {
      const [job] = await tx.select().from(whatsappNotifications).where(and(eq(whatsappNotifications.status, "pending"), lte(whatsappNotifications.availableAt, now))).orderBy(asc(whatsappNotifications.availableAt), asc(whatsappNotifications.id)).limit(1).for("update", { skipLocked: true });
      if (!job) return null;
      const [consent] = await tx.select().from(whatsappConsents).where(eq(whatsappConsents.appointmentId, job.appointmentId));
      const [visit] = await tx.select({ startsAt: appointments.startsAt, timezone: appointments.timezone, status: appointments.status }).from(appointments).where(eq(appointments.id, job.appointmentId));
      if (!consent?.consented || consent.withdrawn || !visit || visit.status !== "confirmed" || visit.startsAt <= now) {
        await tx.update(whatsappNotifications).set({ status: "suppressed", errorCode: "INACTIVE_CONSENT_OR_VISIT", updatedAt: now }).where(eq(whatsappNotifications.id, job.id));
        return { suppressed: true as const };
      }
      const number = job.attempts + 1;
      await tx.update(whatsappNotifications).set({ status: "sending", attempts: number, updatedAt: now, errorCode: null }).where(eq(whatsappNotifications.id, job.id));
      const [attempt] = await tx.insert(whatsappAttempts).values({ notificationId: job.id, number, status: "sending", startedAt: now }).returning({ id: whatsappAttempts.id });
      return { suppressed: false as const, job, attempt, visit, number };
    });
    if (!claimed) return false;
    if (claimed.suppressed) return true;
    // Recheck immediately before dispatch. Withdrawal cannot recall an in-flight request.
    const [consent] = await db.select().from(whatsappConsents).where(eq(whatsappConsents.appointmentId, claimed.job.appointmentId));
    let result: SendResult | { status: "suppressed"; errorCode: string };
    if (!consent?.consented || consent.withdrawn) result = { status: "suppressed", errorCode: "CONSENT_WITHDRAWN" };
    else {
      try { result = await sender.send(claimed.visit); }
      catch { result = { status: "uncertain", errorCode: "SENDER_INTERRUPTED" }; }
    }
    const finished = clock();
    const retry = result.status === "failed" && result.retryable && claimed.number < 3;
    await db.transaction(async (tx) => {
      // Late results from the same attempt can reconcile an interrupted job.
      // Uncertain jobs are never reclaimed for another send.
      const updated = await tx.update(whatsappNotifications).set({ status: retry ? "pending" : result.status,
        apiMessageId: "apiMessageId" in result ? result.apiMessageId ?? null : null, errorCode: result.errorCode ?? null,
        updatedAt: finished, availableAt: new Date(finished.getTime() + 60_000 * claimed.number) })
        .where(and(eq(whatsappNotifications.id, claimed.job.id), inArray(whatsappNotifications.status, ["sending", "uncertain"]), eq(whatsappNotifications.attempts, claimed.number))).returning({ id: whatsappNotifications.id });
      if (updated.length) await tx.update(whatsappAttempts).set({ status: result.status, finishedAt: finished,
        apiMessageId: "apiMessageId" in result ? result.apiMessageId ?? null : null, errorCode: result.errorCode ?? null }).where(eq(whatsappAttempts.id, claimed.attempt.id));
    });
    return true;
  }
  return { runOnce };
}
