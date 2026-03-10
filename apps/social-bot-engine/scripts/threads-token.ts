import "../src/config.js";

type Mode = "exchange" | "refresh";

interface ThreadsTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

function getArgFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function getMode(): Mode {
  const mode = process.argv.slice(2).find((arg) => arg === "exchange" || arg === "refresh");
  if (mode === "exchange" || mode === "refresh") return mode;
  throw new Error('Usage: node --import tsx scripts/threads-token.ts <exchange|refresh> [--token-only] [--json]');
}

function getRequiredEnv(key: string): string {
  const value = (process.env[key] ?? "").trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-6)}`;
}

function buildUrl(mode: Mode): URL {
  if (mode === "exchange") {
    const url = new URL("https://graph.threads.net/access_token");
    url.searchParams.set("grant_type", "th_exchange_token");
    url.searchParams.set("client_secret", getRequiredEnv("THREADS_APP_SECRET"));
    url.searchParams.set(
      "access_token",
      getRequiredEnv("THREADS_SHORT_LIVED_ACCESS_TOKEN")
    );
    return url;
  }

  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", getRequiredEnv("THREADS_ACCESS_TOKEN"));
  return url;
}

async function requestToken(mode: Mode): Promise<{
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  mode: Mode;
}> {
  const response = await fetch(buildUrl(mode), { method: "GET" });
  const payload = (await response.json()) as ThreadsTokenResponse;

  if (!response.ok || !payload.access_token || !payload.token_type || typeof payload.expires_in !== "number") {
    const message = payload.error?.message ?? `Threads token ${mode} request failed with status ${response.status}`;
    throw new Error(message);
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    mode,
  };
}

async function main(): Promise<void> {
  const mode = getMode();
  const tokenOnly = getArgFlag("--token-only");
  const json = getArgFlag("--json");
  const result = await requestToken(mode);

  if (tokenOnly) {
    process.stdout.write(result.accessToken);
    return;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `${mode === "exchange" ? "Exchanged" : "Refreshed"} Threads token ${maskToken(result.accessToken)}`
  );
  console.log(`Expires at: ${result.expiresAt}`);
  console.log(`Expires in: ${result.expiresIn} seconds`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
