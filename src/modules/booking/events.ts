import type { BookingReceipt } from "./models";
import type { ApplicationDatabase } from "@/db/connection";
export type BookingTransaction = Parameters<Parameters<ApplicationDatabase["transaction"]>[0]>[0];
export type BookingEvents = {
  // Persistence only: external calls must wait until after the booking commits.
  created?(tx: BookingTransaction, event: { appointmentId: string; whatsappConsent: boolean; at: Date; actorKind: "patient" | "staff"; receipt: BookingReceipt; clinic: { clinicName: string; doctorName: string; email: string; phone: string } }): Promise<void>;
};
