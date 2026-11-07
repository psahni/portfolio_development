import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createClinicService } from "./service";

export function getClinicService() {
  return createClinicService(getDatabase().db, getIdentity().access);
}
