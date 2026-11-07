import { getClinicService } from "@/modules/clinic/server";
import { createClinicHandler } from "@/modules/clinic/http";
import { getIdentity } from "@/modules/identity/server";

const handler = createClinicHandler(getClinicService, () => getIdentity().staff.options.baseURL);
export const GET = handler;
export const PUT = handler;
