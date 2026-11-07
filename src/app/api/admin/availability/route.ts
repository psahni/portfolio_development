import { getSchedulingService } from "@/modules/scheduling/server";
import { createSchedulingHandler } from "@/modules/scheduling/http";
import { getIdentity } from "@/modules/identity/server";

const handler = createSchedulingHandler(getSchedulingService, () => getIdentity().staff.options.baseURL);
export const GET = handler;
export const PUT = handler;
export const POST = handler;
export const DELETE = handler;
