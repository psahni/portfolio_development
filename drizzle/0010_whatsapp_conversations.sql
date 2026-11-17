CREATE TABLE "whatsapp_conversations" (
	"sender_hash" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whatsapp_conversation_state" CHECK ("whatsapp_conversations"."state" in ('MAIN_MENU', 'WAITING_FOR_NAME', 'WAITING_FOR_EMAIL', 'WAITING_FOR_CODE', 'SELECTING_DATE', 'SELECTING_SLOT', 'CONFIRMING_BOOKING', 'BOOKING_COMPLETED', 'SUPPORT_REQUESTED'))
);
--> statement-breakpoint
CREATE TABLE "whatsapp_webhook_messages" (
	"message_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
