import { createClinicAvailabilityHandler } from "@/modules/booking/clinic-booking-http";
import { getClinicBookingAvailability } from "@/modules/booking/clinic-booking-server";

export const dynamic = "force-dynamic";
export const GET = createClinicAvailabilityHandler(getClinicBookingAvailability);
