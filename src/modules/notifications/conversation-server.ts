import "server-only";
import { getDatabase } from "@/db/server";
import { getIdentity } from "@/modules/identity/server";
import { getBookingService } from "@/modules/booking/server";
import { createSlotAvailabilityService } from "@/modules/scheduling/slots";
import { createMetaConversationSender, readConversationMetaConfig } from "./meta-conversation";
import { createWhatsAppConversationService } from "./conversation-service";

export function getWhatsAppConversationService() {
  const config = readConversationMetaConfig();
  if (!config) return null;
  const database = getDatabase().db;
  return createWhatsAppConversationService(database, getBookingService(), createSlotAvailabilityService(database),
    getIdentity().patient, createMetaConversationSender(config), process.env.BOOKING_DATA_KEY);
}
