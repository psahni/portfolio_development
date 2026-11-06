export const TEST_LOGIN_CODE = "0000";

/** Server configuration only. No request/body parameter may enable test authentication. */
export function resolveTestAuthMode(enabled: boolean, baseURL: string) {
  if (!enabled) return false;
  const runtime = process.env.NODE_ENV ?? "development";
  const url = new URL(baseURL);
  if (!["development", "test"].includes(runtime) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("AUTH_TEST_MODE is allowed only for local development/test origins.");
  }
  return true;
}
