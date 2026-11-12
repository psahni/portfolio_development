import { createStaffHandler } from "@/modules/staff/http";
import { getStaffService } from "@/modules/staff/server";
import { getIdentity } from "@/modules/identity/server";

const handler = createStaffHandler(getStaffService, () => getIdentity().staff.options.baseURL);
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
