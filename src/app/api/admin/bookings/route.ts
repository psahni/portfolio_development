import { createClinicBookingHandler } from "@/modules/booking/clinic-booking-http";
import { getBookingService } from "@/modules/booking/server";
import { readAuthEnvironment } from "@/platform/env";

import { getDatabase } from "@/db/server";
import { createPostBookingLocalEmail } from "@/modules/notifications/local-booking-email";

export const dynamic = "force-dynamic";
export const POST = createClinicBookingHandler(getBookingService, () => readAuthEnvironment().APP_URL, createPostBookingLocalEmail(() => getDatabase().db));
