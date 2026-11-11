export const CANCELLATION_NOTICE_MS = 2 * 60 * 60 * 1000;
export const cancellationPolicy = "Please give at least 2 hours’ notice. You can cancel until your appointment starts; less than 2 hours’ notice is recorded as a late cancellation. After 2 cancellations, wait 3 hours before booking again, or call the clinic for help. No cancellation fee applies.";
export const rebookingPolicy = "To choose another time, cancel first, then book another appointment. Availability is checked again. Your original appointment stays cancelled even if you do not finish the new booking.";
export function isLateCancellation(startsAt: Date, cancelledAt: Date) {
  return startsAt.getTime() - cancelledAt.getTime() < CANCELLATION_NOTICE_MS;
}
