import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { createSchedulingService } from "./service";

export function getSchedulingService() { return createSchedulingService(getDatabase().db, getIdentity().access); }
