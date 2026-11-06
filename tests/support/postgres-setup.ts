import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext { databaseUrl: string }
}

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate local database port.");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

export default async function setup(project: TestProject) {
  const port = await unusedPort();
  const password = randomBytes(24).toString("hex");
  const databaseDir = await mkdtemp(join(tmpdir(), "nuvortiq-test-postgres-"));
  const postgres = new EmbeddedPostgres({
    databaseDir, user: "nuvortiq_test", password, port,
    authMethod: "scram-sha-256", persistent: false,
    autoRehydrateSymlinks: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=", "-c", "max_connections=20"],
    onLog: () => {}, onError: () => {},
  });
  try {
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("nuvortiq_test");
    project.provide("databaseUrl", `postgresql://nuvortiq_test:${password}@127.0.0.1:${port}/nuvortiq_test`);
  } catch (error) {
    await postgres.stop().catch(() => {});
    throw error;
  }
  return async () => { await postgres.stop(); };
}
