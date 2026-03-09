import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "../..");

// Load env: bot .env first, then workspace .env.local and .env (so x-automation/.env.local works)
dotenv.config({ path: resolve(REPO_ROOT, ".env") });
dotenv.config({ path: resolve(WORKSPACE_ROOT, ".env.local") });
dotenv.config({ path: resolve(WORKSPACE_ROOT, ".env") });

export const MAX_TWEET_LEN = 280;
export const MAX_THREADS_TEXT_LEN = 500;
export const SUPPORTED_POST_TARGETS = ["x", "threads"] as const;
export type PostTarget = (typeof SUPPORTED_POST_TARGETS)[number];

function getEnv(key: string, defaultValue = ""): string {
  return (process.env[key] ?? defaultValue).trim();
}

function getIntEnv(key: string, defaultValue: number): number {
  const raw = getEnv(key, String(defaultValue));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

// X (Twitter): support both X_CONSUMER_* and X_APP_*, X_ACCESS_SECRET
export const X_CONSUMER_KEY = getEnv("X_CONSUMER_KEY") || getEnv("X_APP_KEY");
export const X_CONSUMER_SECRET = getEnv("X_CONSUMER_SECRET") || getEnv("X_APP_SECRET");
export const X_ACCESS_TOKEN = getEnv("X_ACCESS_TOKEN");
export const X_ACCESS_TOKEN_SECRET = getEnv("X_ACCESS_TOKEN_SECRET") || getEnv("X_ACCESS_SECRET");

// Threads (Meta Graph API)
export const THREADS_ACCESS_TOKEN = getEnv("THREADS_ACCESS_TOKEN");
export const THREADS_GRAPH_API_VERSION = getEnv("THREADS_GRAPH_API_VERSION", "v1.0");

// LLM: If OPENAI_API_KEY is set, use OpenAI's API. Else use LLM_API_KEY + LLM_BASE_URL (e.g. Gemini).
export const OPENAI_API_KEY = getEnv("OPENAI_API_KEY") || getEnv("LLM_API_KEY");
export const USE_OPENAI_API = getEnv("OPENAI_API_KEY").length > 0;
export const LLM_BASE_URL = getEnv("LLM_BASE_URL");
export const LLM_MODEL = getEnv("LLM_MODEL", "gpt-4o-mini");
/** Model used for generation: when using OpenAI API use an OpenAI model, else use LLM_MODEL (e.g. gemini-2.5-flash). */
export const ACTIVE_LLM_MODEL = USE_OPENAI_API ? getEnv("OPENAI_MODEL", "gpt-4o-mini") : LLM_MODEL;

export const API_SPORTS_KEY = getEnv("API_SPORTS_KEY");

const targetSportRaw = getEnv("TARGET_SPORT", "auto").toLowerCase();
export const TARGET_SPORT = targetSportRaw || "nba";

/** Sports we rotate through when TARGET_SPORT=auto. Order balances NFL (weekend) with others. */
export const ROTATION_SPORTS = ["nba", "nfl", "mlb", "soccer"] as const;

/** Fact angles we rotate through so each day gets a different focus and tweets stay unique. */
export const FACT_ANGLES = [
  "film review timing and retention (e.g. within 24–48 hours)",
  "specific feedback vs generic (stats or research on impact)",
  "hours spent on film / data (pro vs amateur)",
  "key moments: focusing on 2–3 critical plays rather than everything",
  "opponent tendency analysis and preparation",
  "shot selection or decision-making and efficiency stats",
  "set pieces, in-game adjustments, or situational awareness",
  "data analytics and game preparation (e.g. % improvement)",
] as const;

/** Pick a fact angle for the given date (deterministic per day, varies across days). */
export function getAngleForDate(date: Date): string {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000)
  );
  return FACT_ANGLES[dayOfYear % FACT_ANGLES.length];
}

/** Pick sport for this run: use TARGET_SPORT unless it's "auto", then rotate by day of week. */
export function getSportForRun(): string {
  if (targetSportRaw !== "auto" && ROTATION_SPORTS.includes(targetSportRaw as (typeof ROTATION_SPORTS)[number])) {
    return targetSportRaw;
  }
  const day = new Date().getDay();
  const index = day % ROTATION_SPORTS.length;
  return ROTATION_SPORTS[index];
}

// Prod (CI, e.g. GitHub Actions): post for real. Dev (local): dry run unless POST_ENABLED is set.
const postEnv = getEnv("POST_ENABLED");
const inCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const defaultPostEnabled = inCI;
const postEnabledRaw = (postEnv || (defaultPostEnabled ? "true" : "false")).toLowerCase() || (defaultPostEnabled ? "true" : "false");
export const POST_ENABLED = !["false", "0", "no"].includes(postEnabledRaw);

export const PROMPTS_DIR = resolve(REPO_ROOT, "prompts");
export const LOGS_DIR = resolve(REPO_ROOT, "logs");
export const STATE_DIR = resolve(REPO_ROOT, "state");
export const ANALYTICS_STORE_FILENAME = getEnv("ANALYTICS_STORE_FILENAME", "tweet-analytics.json");
export const ANALYTICS_ENABLED = !["false", "0", "no"].includes(getEnv("ANALYTICS_ENABLED", "true").toLowerCase());
export const ANALYTICS_LOOKBACK_DAYS = Math.max(1, getIntEnv("ANALYTICS_LOOKBACK_DAYS", 21));
export const ANALYTICS_MIN_AGE_MINUTES = Math.max(5, getIntEnv("ANALYTICS_MIN_AGE_MINUTES", 45));
export const ANALYTICS_MAX_REFRESH = Math.max(1, getIntEnv("ANALYTICS_MAX_REFRESH", 40));
export const TRACKING_BASE_URL = getEnv("TRACKING_BASE_URL");
export const CLICK_TARGET_URL = getEnv("CLICK_TARGET_URL", "https://getpostgame.ai");
export const NEWS_API_KEY = getEnv("NEWS_API_KEY");
export const NEWS_ENABLED = !["false", "0", "no"].includes(getEnv("NEWS_ENABLED", "true").toLowerCase());
export const NEWS_LOOKBACK_HOURS = Math.max(1, getIntEnv("NEWS_LOOKBACK_HOURS", 36));
export const NEWS_MAX_ARTICLES = Math.min(100, Math.max(1, getIntEnv("NEWS_MAX_ARTICLES", 10)));
export const NEWS_LANGUAGE = getEnv("NEWS_LANGUAGE", "en");
export const NEWS_SORT_BY = getEnv("NEWS_SORT_BY", "publishedAt");
export const DEFAULT_NEWS_ALLOWED_DOMAINS = [
  "espn.com",
  "theathletic.com",
  "sports.yahoo.com",
  "cbssports.com",
  "nbcsports.com",
  "foxsports.com",
  "si.com",
  "sportingnews.com",
  "bleacherreport.com",
  "apnews.com",
  "reuters.com",
  "usatoday.com",
  "goal.com",
  "sportsnet.ca",
  "mlb.com",
  "nba.com",
  "nfl.com",
] as const;

function parseCsvEnv(key: string): string[] {
  return getEnv(key)
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export const NEWS_ALLOWED_DOMAINS = (() => {
  const configured = parseCsvEnv("NEWS_ALLOWED_DOMAINS");
  return configured.length > 0 ? configured : [...DEFAULT_NEWS_ALLOWED_DOMAINS];
})();

export const NEWS_ALLOWED_SOURCES = parseCsvEnv("NEWS_ALLOWED_SOURCES");

function parsePostTargets(): PostTarget[] {
  const configured = parseCsvEnv("POST_TARGETS");
  const normalized = configured.length > 0 ? configured : ["x"];
  const filtered = normalized.filter((value): value is PostTarget =>
    SUPPORTED_POST_TARGETS.includes(value as PostTarget)
  );
  return filtered.length > 0 ? [...new Set(filtered)] : ["x"];
}

export const POST_TARGETS = parsePostTargets();
export const POSTS_TO_X = POST_TARGETS.includes("x");
export const POSTS_TO_THREADS = POST_TARGETS.includes("threads");
export const MAX_POST_LEN = POSTS_TO_X ? MAX_TWEET_LEN : MAX_THREADS_TEXT_LEN;

export interface ValidateConfigOptions {
  requireX?: boolean;
  requireThreads?: boolean;
  requireOpenai?: boolean;
  requireApiSports?: boolean;
}

export function validateConfig(options: ValidateConfigOptions = {}): string[] {
  const { requireX = true, requireThreads = false, requireOpenai = true, requireApiSports = false } = options;
  const missing: string[] = [];
  if (requireX && (!X_CONSUMER_KEY || !X_CONSUMER_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET)) {
    missing.push("X_CONSUMER_KEY/X_APP_KEY", "X_CONSUMER_SECRET/X_APP_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET/X_ACCESS_SECRET");
  }
  if (requireThreads && !THREADS_ACCESS_TOKEN) missing.push("THREADS_ACCESS_TOKEN");
  if (requireOpenai && !OPENAI_API_KEY) missing.push("OPENAI_API_KEY or LLM_API_KEY");
  if (requireApiSports && !API_SPORTS_KEY) missing.push("API_SPORTS_KEY");
  return [...new Set(missing)];
}
