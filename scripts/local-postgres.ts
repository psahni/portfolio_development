import { mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

async function main() {
  const databaseDir = resolve(".local/postgres");
  await mkdir(databaseDir, { recursive: true });
  const postgres = new EmbeddedPostgres({
    databaseDir, user: "nuvortiq", password: "nuvortiq_dev_only", port: 54329,
    authMethod: "scram-sha-256", persistent: true, autoRehydrateSymlinks: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories="],
    onLog: () => {}, onError: () => {},
  });
  try { await access(resolve(databaseDir, "PG_VERSION")); }
  catch { await postgres.initialise(); }
  await postgres.start();
  const client = postgres.getPgClient("postgres", "127.0.0.1");
  try {
    await client.connect();
    const result = await client.query("select 1 from pg_database where datname = $1", ["nuvortiq"]);
    if (!result.rowCount) await client.query('create database "nuvortiq"');
  } finally { await client.end(); }
  process.stdout.write("Local PostgreSQL ready on 127.0.0.1:54329. Use .env.example settings. Ctrl+C stops it and preserves data.\n");
  await new Promise<void>((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => resolve());
  });
  await postgres.stop();
}

main().catch(() => {
  process.stderr.write("Local PostgreSQL failed. Check port 54329, platform support and database directory permissions.\n");
  process.exitCode = 1;
});
