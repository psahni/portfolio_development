import "server-only";
import { chmod, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { AuthMailer, LoginCode } from "./mail";

/** Local-only simulated email. The one-time code is intentionally visible in this ignored file. */
export function createLocalAuthMailer(directory = join(process.cwd(), ".local")): AuthMailer {
  async function write(kind: "patient" | "staff", { email, code }: LoginCode) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "email-preview.log");
    const file = await open(path, "a", 0o600);
    try {
      await chmod(path, 0o600);
      const body = `Your ${kind} sign-in code is ${code}. It expires in five minutes and can be used once.`;
      await file.write(`${JSON.stringify({ event: "auth_email_simulated", delivery: "simulated email — not sent", kind, to: email, subject: "Your sign-in code", body, createdAt: new Date().toISOString() })}\n`);
    } finally { await file.close(); }
  }
  return {
    sendPatientLoginCode: (message) => write("patient", message),
    sendStaffLoginCode: (message) => write("staff", message),
  };
}
