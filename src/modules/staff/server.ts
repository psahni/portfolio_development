import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createStaffService } from "./service";

export function getStaffService() {
  return createStaffService(getDatabase().db, getIdentity().access);
}
