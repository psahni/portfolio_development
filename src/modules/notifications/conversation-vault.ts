import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export function createWhatsAppConversationVault(encodedKey: string | undefined) {
  if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) || Buffer.from(encodedKey, "base64").length !== 32) {
    throw new Error("Invalid server configuration: BOOKING_DATA_KEY must be 32 random bytes encoded as base64.");
  }
  const root = Buffer.from(encodedKey, "base64");
  const encryptionKey = Buffer.from(hkdfSync("sha256", root, "nuvortiq-booking-v1", "whatsapp-conversation", 32));
  const indexKey = Buffer.from(hkdfSync("sha256", root, "nuvortiq-booking-v1", "whatsapp-sender-index", 32));
  return {
    senderHash(phone: string) { return createHmac("sha256", indexKey).update(phone).digest("hex"); },
    encrypt(senderHash: string, value: unknown) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
      cipher.setAAD(Buffer.from(`whatsapp-conversation:${senderHash}:v1`));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
    },
    decrypt<T>(senderHash: string, envelope: string): T {
      try {
        const [version, iv, tag, ciphertext, extra] = envelope.split(".");
        if (version !== "v1" || extra !== undefined || !ciphertext || Buffer.from(iv, "base64").length !== 12 || Buffer.from(tag, "base64").length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64"));
        decipher.setAAD(Buffer.from(`whatsapp-conversation:${senderHash}:v1`));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8")) as T;
      } catch { throw new Error("Unable to read protected WhatsApp conversation state."); }
    },
  };
}
