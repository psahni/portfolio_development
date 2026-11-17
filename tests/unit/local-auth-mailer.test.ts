import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalAuthMailer } from "@/platform/local-auth-mailer";

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

describe("local authentication email preview", () => {
  it("writes a simulated one-time code to a private log file", async () => {
    directory = await mkdtemp(join(tmpdir(), "nuvortiq-auth-email-"));
    await createLocalAuthMailer(directory).sendPatientLoginCode({ email: "patient@example.test", code: "483920" });
    const path = join(directory, "email-preview.log"), contents = await readFile(path, "utf8"), info = await stat(path);
    expect(JSON.parse(contents)).toMatchObject({ event: "auth_email_simulated", delivery: "simulated email — not sent", kind: "patient", to: "patient@example.test", body: "Your patient sign-in code is 483920. It expires in five minutes and can be used once." });
    expect(info.mode & 0o777).toBe(0o600);
  });
});
