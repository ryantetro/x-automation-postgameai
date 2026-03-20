import "../src/config.js";
import { exchangeThreadsToken, maskThreadsToken, refreshThreadsToken, type ThreadsTokenMode } from "../src/threadsToken.js";

function getArgFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function getMode(): ThreadsTokenMode {
  const mode = process.argv.slice(2).find((arg) => arg === "exchange" || arg === "refresh");
  if (mode === "exchange" || mode === "refresh") return mode;
  throw new Error('Usage: node --import tsx scripts/threads-token.ts <exchange|refresh> [--token-only] [--json]');
}

function getRequiredEnv(key: string): string {
  const value = (process.env[key] ?? "").trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

async function main(): Promise<void> {
  const mode = getMode();
  const tokenOnly = getArgFlag("--token-only");
  const json = getArgFlag("--json");
  const result =
    mode === "exchange"
      ? await exchangeThreadsToken(
          getRequiredEnv("THREADS_SHORT_LIVED_ACCESS_TOKEN"),
          getRequiredEnv("THREADS_APP_SECRET")
        )
      : await refreshThreadsToken(getRequiredEnv("THREADS_ACCESS_TOKEN"));

  if (tokenOnly) {
    process.stdout.write(result.accessToken);
    return;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    `${mode === "exchange" ? "Exchanged" : "Refreshed"} Threads token ${maskThreadsToken(result.accessToken)}`
  );
  console.log(`Expires at: ${result.expiresAt}`);
  console.log(`Expires in: ${result.expiresIn} seconds`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
