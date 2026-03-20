import { refreshThreadsToken } from "../src/threadsToken.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

type CampaignCredentials = Record<string, Record<string, string>>;

interface RefreshResult {
  refreshedCampaigns: Array<{
    campaign: string;
    expiresAt: string;
  }>;
  updatedCredentialsJson: string;
}

function getArgFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

function getRequiredEnv(key: string): string {
  const value = (process.env[key] ?? "").trim();
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function parseCampaignCredentials(raw: string): CampaignCredentials {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BOT_CREDENTIALS_JSON must be a JSON object keyed by campaign slug");
  }
  return parsed as CampaignCredentials;
}

export async function refreshCampaignThreadsTokens(credentials: CampaignCredentials): Promise<RefreshResult> {
  const updated: CampaignCredentials = JSON.parse(JSON.stringify(credentials)) as CampaignCredentials;
  const refreshedCampaigns: RefreshResult["refreshedCampaigns"] = [];

  for (const campaign of Object.keys(updated).sort()) {
    const token = updated[campaign]?.THREADS_ACCESS_TOKEN?.trim();
    if (!token) continue;
    const refreshed = await refreshThreadsToken(token);
    updated[campaign] = {
      ...updated[campaign],
      THREADS_ACCESS_TOKEN: refreshed.accessToken,
    };
    refreshedCampaigns.push({
      campaign,
      expiresAt: refreshed.expiresAt,
    });
  }

  return {
    refreshedCampaigns,
    updatedCredentialsJson: JSON.stringify(updated),
  };
}

async function main(): Promise<void> {
  const json = getArgFlag("--json");
  const credentials = parseCampaignCredentials(getRequiredEnv("BOT_CREDENTIALS_JSON"));
  const result = await refreshCampaignThreadsTokens(credentials);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  if (result.refreshedCampaigns.length === 0) {
    console.log("No campaign Threads tokens found in BOT_CREDENTIALS_JSON.");
    return;
  }

  console.log(`Refreshed ${result.refreshedCampaigns.length} campaign Threads token(s):`);
  for (const row of result.refreshedCampaigns) {
    console.log(`- ${row.campaign} (expires ${row.expiresAt})`);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
