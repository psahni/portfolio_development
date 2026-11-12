import "server-only";
import type { ApplicationDatabase } from "@/db/connection";
import type { ClinicPrincipal } from "@/modules/identity/access";
import { createSlotAvailabilityService } from "@/modules/scheduling/slots";

export function createClinicBookingAvailability(db: ApplicationDatabase, access: {
  requireClinicAccess(headers: Headers): Promise<ClinicPrincipal>;
}, clock = () => new Date()) {
  const slots = createSlotAvailabilityService(db, clock);
  return {
    async view(headers: Headers, date?: string) {
      await access.requireClinicAccess(headers);
      return slots.read(date);
    },
  };
}
