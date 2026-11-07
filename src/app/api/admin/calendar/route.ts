import { getSchedulingService } from "@/modules/scheduling/server";
import { createCalendarHandler } from "@/modules/scheduling/calendar-http";

export const GET = createCalendarHandler(getSchedulingService);
