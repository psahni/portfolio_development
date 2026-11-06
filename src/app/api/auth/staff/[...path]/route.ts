import { createStaffAuthHandler } from "@/modules/identity/http";
import { getIdentity } from "@/modules/identity/server";

export const POST = createStaffAuthHandler(() => getIdentity().staff, () => getIdentity().staff.options.baseURL);
