import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateConfig,
  POST_ENABLED,
  getSportForRun,
  getAngleForDate,
  LOGS_DIR,
} from "./config.js";
import { fetchSportsData } from "./fetchData.js";
import { generatePost, fillFallbackTemplate } from "./generatePost.js";
import { isValidTweet } from "./validate.js";
import { postToX } from "./postToX.js";

const MAX_GENERATE_RETRIES = 3;
const LOG_FILE = resolve(LOGS_DIR, "posts.log");
const RECENT_TWEETS_CAP = 60;

/** Read last N successful tweet texts from the log (newest first). */
function readRecentTweetTexts(logPath: string, cap: number): string[] {
  if (!existsSync(logPath)) return [];
  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const out: string[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < cap; i--) {
    const parts = lines[i]!.split("\t");
    if (parts[1] === "success" && parts[2] && !parts[2].startsWith("error=")) {
      out.push(parts[2].trim());
    }
  }
  return out;
}

/** True if candidate is exact duplicate or too similar to any recent tweet (same lead or high overlap). */
function isDuplicate(candidate: string, recentTexts: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const cNorm = norm(candidate);
  const cLead = cNorm.slice(0, 70);
  for (const t of recentTexts) {
    if (norm(t) === cNorm) return true;
    if (norm(t).slice(0, 70) === cLead) return true;
  }
  return false;
}

function appendLog(success: boolean, text: string | null, error: string | null): void {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
  } catch {
    // ignore
  }
  const ts = new Date().toISOString();
  const status = success ? "success" : "failure";
  let line = `${ts}\t${status}\t`;
  if (text) line += text.replace(/\n/g, " ").replace(/\t/g, " ");
  if (error) line += `\terror=${error.replace(/\t/g, " ")}`;
  line += "\n";
  appendFileSync(LOG_FILE, line, "utf-8");
}

async function main(): Promise<number> {
  const missing = validateConfig({
    requireX: POST_ENABLED,
    requireOpenai: true,
    requireApiSports: false,
  });
  if (missing.length > 0) {
    console.error("Missing required env vars:", missing.join(", "));
    appendLog(false, null, `Missing env: ${missing.join(",")}`);
    return 1;
  }

  const sport = getSportForRun();
  let fetched = await fetchSportsData(sport);
  if (!fetched) {
    console.warn("No data from API-Sports or ESPN; using minimal fallback");
    const today = new Date().toISOString().slice(0, 10);
    fetched = {
      sport,
      source: "none",
      date: today,
      games: [],
      summary: "No games today.",
      top_game: {},
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const angle = getAngleForDate(new Date());
  let recentTexts = readRecentTweetTexts(LOG_FILE, RECENT_TWEETS_CAP);

  let text: string | null = null;
  for (let attempt = 0; attempt < MAX_GENERATE_RETRIES; attempt++) {
    text = await generatePost(fetched, 1, {
      recentTweets: recentTexts,
      angle,
      date: today,
    });
    if (text && isValidTweet(text)) {
      if (!isDuplicate(text, recentTexts)) break;
      console.info("Tweet too similar to recent; retrying with avoid list");
      recentTexts = [text, ...recentTexts].slice(0, RECENT_TWEETS_CAP);
    } else if (text && !isValidTweet(text)) {
      console.info("Generated tweet invalid (length or brand), attempt", attempt + 1);
    }
  }
  if (!text || !isValidTweet(text)) {
    console.info("Using fallback template");
    text = fillFallbackTemplate(fetched.sport ?? "nba", fetched);
  }
  if (text && isValidTweet(text) && isDuplicate(text, readRecentTweetTexts(LOG_FILE, RECENT_TWEETS_CAP))) {
    console.warn("Fallback tweet is similar to a recent post; posting anyway to avoid skipping");
  }

  if (!isValidTweet(text)) {
    console.error("Final text still invalid (length or missing postgame.ai); aborting");
    appendLog(false, text, "Validation failed");
    return 1;
  }

  const { success, error } = await postToX(text);
  appendLog(success, text, error ?? null);
  if (!success) {
    console.error("Post failed:", error);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    appendLog(false, null, String(err));
    process.exit(1);
  });
