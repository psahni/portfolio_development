import "server-only";

export type WhatsAppFailureLogger = (failure: { appointmentId: string; status: "failed" | "uncertain"; code: string }) => void;
export const logWhatsAppFailure: WhatsAppFailureLogger = ({ appointmentId, status, code }) => {
  // Call only with internal IDs and our validated codes, never raw errors or config.
  console.warn(`WhatsApp notification could not be sent or confirmed; appointment remains confirmed. appointment=${appointmentId} status=${status} code=${code}`);
};
