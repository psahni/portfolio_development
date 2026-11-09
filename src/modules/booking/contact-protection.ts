import "server-only";
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { contactSchema, type PatientContact } from "./models";

export function createContactProtection(encodedKey: string | undefined) {
  if (!encodedKey || !/^[A-Za-z0-9+/]{43}=$/.test(encodedKey) || Buffer.from(encodedKey, "base64").length !== 32) {
    throw new Error("Invalid server configuration: BOOKING_DATA_KEY must be 32 random bytes encoded as base64.");
  }
  const root = Buffer.from(encodedKey, "base64");
  const key = Buffer.from(hkdfSync("sha256", root, "nuvortiq-booking-v1", "contacts", 32));
  const fingerprintKey = Buffer.from(hkdfSync("sha256", root, "nuvortiq-booking-v1", "request-fingerprint", 32));
  return {
    encrypt(id: string, contact: PatientContact) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(`appointment:${id}:v1`));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(contactSchema.parse(contact)), "utf8"), cipher.final()]);
      return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
    },
    decrypt(id: string, envelope: string): PatientContact {
      try {
        const [version, iv, tag, ciphertext, extra] = envelope.split(".");
        if (version !== "v1" || extra !== undefined || !ciphertext || Buffer.from(iv, "base64").length !== 12 || Buffer.from(tag, "base64").length !== 16) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
        decipher.setAAD(Buffer.from(`appointment:${id}:v1`));
        decipher.setAuthTag(Buffer.from(tag, "base64"));
        const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]);
        return contactSchema.parse(JSON.parse(plaintext.toString("utf8")));
      } catch { throw new Error("Unable to read protected appointment contacts."); }
    },
    fingerprint(payload: string) { return createHmac("sha256", fingerprintKey).update(payload).digest("hex"); },
  };
}
export type ContactProtection = ReturnType<typeof createContactProtection>;
