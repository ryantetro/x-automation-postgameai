/**
 * Loads campaign config and (optionally) credentials, then sets process.env
 * so the rest of the bot uses the right brand, state dir, and API keys.
 * Must run before config.ts (and thus main) are used — use run.ts as entry.
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "../..");
const CAMPAIGNS_DIR = resolve(WORKSPACE_ROOT, "campaigns");

function loadEnv(): void {
  dotenv.config({ path: resolve(REPO_ROOT, ".env") });
  dotenv.config({ path: resolve(WORKSPACE_ROOT, ".env.local") });
  dotenv.config({ path: resolve(WORKSPACE_ROOT, ".env") });
}

export interface CampaignConfig {
  slug?: string;
  name: string;
  brandName: string;
  brandWebsite: string;
  clickTargetUrl: string;
  postTargets?: ("x" | "threads")[];
  dataSource?: "sports" | "news" | "angles_only";
  trackingBaseUrl?: string;
  imageEnabled?: boolean;
}

function setEnv(key: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    process.env[key] = value;
  }
}

/**
 * Load campaign config from campaigns/<slug>/config.json and apply to process.env.
 * If BOT_CREDENTIALS_JSON is set, parse and apply that slug's credentials too.
 * Sets CAMPAIGN_STATE_DIR so config.ts can use per-campaign state.
 */
export function bootstrap(): void {
  loadEnv();
  const slug = process.env.CAMPAIGN?.trim();
  if (!slug) {
    console.warn("⚠ No CAMPAIGN set — running with default postgame config. Set CAMPAIGN=<slug> for multi-campaign mode.");
    return;
  }

  const configPath = resolve(CAMPAIGNS_DIR, slug, "config.json");
  if (!existsSync(configPath)) {
    console.warn(`Campaign config not found: ${configPath}; running without campaign overrides.`);
    return;
  }

  let config: CampaignConfig;
  try {
    const raw = readFileSync(configPath, "utf-8");
    config = JSON.parse(raw) as CampaignConfig;
  } catch (err) {
    console.warn(`Failed to load campaign config ${configPath}:`, err);
    return;
  }

  setEnv("BRAND_NAME", config.brandName);
  setEnv("BRAND_WEBSITE", config.brandWebsite);
  setEnv("CLICK_TARGET_URL", config.clickTargetUrl);
  if (config.postTargets?.length) {
    setEnv("POST_TARGETS", config.postTargets.join(","));
  }
  if (config.trackingBaseUrl) {
    setEnv("TRACKING_BASE_URL", config.trackingBaseUrl);
  } else {
    process.env.TRACKING_BASE_URL = "";
  }
  if (config.dataSource) {
    setEnv("DATA_SOURCE", config.dataSource);
  }
  if (config.imageEnabled === true) {
    setEnv("IMAGE_ENABLED", "true");
  }

  const stateDir = resolve(WORKSPACE_ROOT, "state", slug);
  process.env.CAMPAIGN_STATE_DIR = stateDir;
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    // ignore; bot may create when writing
  }

  const credentialsJson = process.env.BOT_CREDENTIALS_JSON?.trim();
  if (credentialsJson) {
    try {
      const all = JSON.parse(credentialsJson) as Record<string, Record<string, string>>;
      const creds = all[slug];
      if (creds && typeof creds === "object") {
        for (const [key, value] of Object.entries(creds)) {
          if (typeof value === "string") setEnv(key, value);
        }
      }
    } catch {
      console.warn("BOT_CREDENTIALS_JSON invalid or missing entry for campaign:", slug);
    }
  }
}
