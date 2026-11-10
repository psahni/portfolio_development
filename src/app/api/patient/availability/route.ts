import { createHostedAvailabilityHandler } from "@/modules/booking/hosted-http";
import { getHostedBookingService } from "@/modules/booking/hosted-server";

export const GET = createHostedAvailabilityHandler(getHostedBookingService);
