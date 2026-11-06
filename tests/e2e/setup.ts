import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase } from "../../src/db/connection";
import { staffAccess, staffUser } from "../../src/db/schema/auth";

async function unusedPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to allocate test port.");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function stopServer(server?: ChildProcess) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => server.kill("SIGKILL"), 5_000);
    server.once("exit", () => { clearTimeout(timeout); resolve(); });
    server.kill("SIGTERM");
  });
}

export default async function setup() {
  const root = process.cwd();
  const folder = await mkdtemp(join(tmpdir(), "nuvortiq-browser-"));
  const pgPassword = randomBytes(24).toString("hex");
  const pgPort = await unusedPort();
  const postgres = new EmbeddedPostgres({
    databaseDir: join(folder, "postgres"), user: "nuvortiq_test", password: pgPassword,
    port: pgPort, authMethod: "scram-sha-256", persistent: false, autoRehydrateSymlinks: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=", "-c", "max_connections=20"],
    onLog: () => {}, onError: () => {},
  });
  let app: ChildProcess | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;
  async function cleanup() {
    await stopServer(app);
    await database?.pool.end();
    await postgres.stop().catch(() => {});
    await rm(folder, { recursive: true, force: true });
  }
  try {
    await postgres.initialise(); await postgres.start(); await postgres.createDatabase("nuvortiq_browser");
    const databaseUrl = `postgresql://nuvortiq_test:${pgPassword}@127.0.0.1:${pgPort}/nuvortiq_browser`;
    database = createDatabase(databaseUrl);
    await migrate(database.db, { migrationsFolder: "./drizzle" });
    const baseURL = `http://127.0.0.1:${await unusedPort()}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env, NODE_ENV: "development", APP_URL: baseURL,
      DATABASE_URL: databaseUrl, MIGRATION_DATABASE_URL: databaseUrl,
      PATIENT_AUTH_SECRET: randomBytes(48).toString("hex"), STAFF_AUTH_SECRET: randomBytes(48).toString("hex"),
      AUTH_TEST_MODE: "true", BOOTSTRAP_ADMIN_EMAIL: "doctor@example.test", BOOTSTRAP_ADMIN_NAME: "Synthetic Doctor", BOOTSTRAP_ADMIN_PIN: "4821",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    await promisify(execFile)(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/bootstrap-admin.ts"], { cwd: root, env, timeout: 20_000 });
    const id = randomUUID();
    await database.db.insert(staffUser).values({ id, name: "Synthetic Staff", email: "staff@example.test" });
    await database.db.insert(staffAccess).values({ userId: id, role: "staff" });

    // The test server gets its own source copy, .next directory and synthetic database.
    const source = join(folder, "app");
    for (const name of ["src", "next.config.ts", "postcss.config.mjs", "tsconfig.json", "package.json", "next-env.d.ts"]) {
      await cp(join(root, name), join(source, name), { recursive: true });
    }
    await symlink(resolve("node_modules"), join(source, "node_modules"), "dir");
    const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", new URL(baseURL).port], { cwd: source, env, stdio: "ignore" });
    app = child;
    const deadline = Date.now() + 90_000;
    while (true) {
      if (child.exitCode !== null) throw new Error("Browser test server exited before startup.");
      try { if ((await fetch(`${baseURL}/admin`)).ok) break; } catch { /* Server is still starting. */ }
      if (Date.now() > deadline) throw new Error("Browser test server did not become ready.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    process.env.NUVORTIQ_E2E_URL = baseURL;
    return cleanup;
  } catch {
    await cleanup();
    throw new Error("Browser test setup failed. Check local PostgreSQL and Next.js prerequisites.");
  }
}
