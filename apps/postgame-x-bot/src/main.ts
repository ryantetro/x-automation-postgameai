import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateConfig,
  POST_ENABLED,
  getSportForRun,
  getAngleForDate,
  LOGS_DIR,
  ANALYTICS_ENABLED,
  ANALYTICS_LOOKBACK_DAYS,
  ANALYTICS_MIN_AGE_MINUTES,
  ANALYTICS_MAX_REFRESH,
  TRACKING_BASE_URL,
  CLICK_TARGET_URL,
  MAX_TWEET_LEN,
} from "./config.js";
import { fetchSportsData } from "./fetchData.js";
import { fetchNewsContext } from "./fetchNews.js";
import { generatePost, fillFallbackTemplate } from "./generatePost.js";
import { isValidTweet } from "./validate.js";
import { getXClient, postToX } from "./postToX.js";
import {
  ANALYTICS_STORE_FILE,
  loadAnalyticsStore,
  saveAnalyticsStore,
  upsertTweetRecord,
  pruneStore,
  refreshMetricsForStore,
  buildIterationInsights,
  formatInsightsReport,
  type AnalyticsStore,
} from "./analytics.js";

const MAX_GENERATE_RETRIES = 3;
const LOG_FILE = resolve(LOGS_DIR, "posts.log");
const ITERATION_REPORT_FILE = resolve(LOGS_DIR, "iteration-report.md");
const RECENT_TWEETS_CAP = 60;

function buildTrackedUrl(runId: string): string | null {
  if (!TRACKING_BASE_URL) return null;
  const base = TRACKING_BASE_URL.replace(/\/+$/, "");
  return `${base}/r/${encodeURIComponent(runId)}`;
}

function appendTrackedUrl(text: string, trackedUrl: string | null): string {
  if (!trackedUrl) return text;
  const next = `${text.trim()} ${trackedUrl}`.trim();
  if (next.length <= MAX_TWEET_LEN) return next;
  console.warn("Tracked link omitted because tweet body used the full character budget");
  return text;
}

/** Read last N posted tweet texts from persistent analytics state (newest first). */
function readRecentTweetTexts(store: AnalyticsStore, cap: number): string[] {
  return store.tweets
    .filter((tweet) => tweet.status === "posted" && !!tweet.text)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, cap)
    .map((tweet) => tweet.text);
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

  const runId = randomUUID();
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  const sport = getSportForRun();
  const angle = getAngleForDate(new Date());
  const trackedUrl = buildTrackedUrl(runId);
  const reserveChars = trackedUrl ? trackedUrl.length + 1 : 0;

  const analyticsStore = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  const xClient = getXClient();

  if (ANALYTICS_ENABLED && xClient) {
    try {
      const refreshed = await refreshMetricsForStore(analyticsStore, xClient, {
        lookbackDays: ANALYTICS_LOOKBACK_DAYS,
        minAgeMinutes: ANALYTICS_MIN_AGE_MINUTES,
        maxTweets: ANALYTICS_MAX_REFRESH,
      });
      if (refreshed.updated > 0) {
        console.info(
          `Analytics refreshed: ${refreshed.updated} tweet(s) updated (${refreshed.attempted} fetched)`
        );
      }
    } catch (err) {
      console.warn("Analytics refresh skipped due to API error:", err);
    }
  }

  const insights = buildIterationInsights(analyticsStore);
  if (insights) {
    try {
      mkdirSync(LOGS_DIR, { recursive: true });
      writeFileSync(ITERATION_REPORT_FILE, `${formatInsightsReport(insights)}\n`, "utf-8");
    } catch {
      // ignore report write issues
    }
  }

  let fetched = await fetchSportsData(sport);
  if (!fetched) {
    console.warn("No data from API-Sports or ESPN; using minimal fallback");
    fetched = {
      sport,
      source: "none",
      date: today,
      games: [],
      summary: "No games today.",
      top_game: {},
    };
  }

  const newsContext = await fetchNewsContext(sport);
  const contentMode = newsContext.usedNews ? "news_preferred" : "sports_only";
  if (newsContext.selectionReason) {
    console.info(`News selection (${contentMode}): ${newsContext.selectionReason}`);
  }

  let recentTexts = readRecentTweetTexts(analyticsStore, RECENT_TWEETS_CAP);

  let text: string | null = null;
  let generationSource = "llm";
  for (let attempt = 0; attempt < MAX_GENERATE_RETRIES; attempt++) {
    text = await generatePost(fetched, 1, {
      recentTweets: recentTexts,
      angle,
      date: today,
      iterationGuidance: insights?.promptGuidance,
      reserveChars,
      newsContext,
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
    text = fillFallbackTemplate(fetched.sport ?? "nba", fetched, { reserveChars, angle });
    generationSource = "fallback";
  }

  text = appendTrackedUrl(text, trackedUrl);

  if (text && isValidTweet(text) && isDuplicate(text, readRecentTweetTexts(analyticsStore, RECENT_TWEETS_CAP))) {
    console.warn("Fallback tweet is similar to a recent post; posting anyway to avoid skipping");
  }

  if (!isValidTweet(text)) {
    console.error("Final text still invalid (length or missing postgame.ai); aborting");
    appendLog(false, text, "Validation failed");
    upsertTweetRecord(analyticsStore, {
      runId,
      postedAt: nowIso,
      dateContext: today,
      sport,
      angle,
      source: generationSource,
      status: "failed",
      text,
      contentMode,
      newsUsed: newsContext.usedNews,
      newsQuery: newsContext.query,
      newsArticleTitle: newsContext.selectedArticle?.title,
      newsArticleUrl: newsContext.selectedArticle?.url,
      newsSourceName: newsContext.selectedArticle?.sourceName,
      newsPublishedAt: newsContext.selectedArticle?.publishedAt,
      trackedUrl: trackedUrl ?? undefined,
      linkTargetUrl: CLICK_TARGET_URL,
    });
    pruneStore(analyticsStore);
    saveAnalyticsStore(analyticsStore, ANALYTICS_STORE_FILE);
    return 1;
  }

  const POST_RETRY_WAIT_MS = 8000;
  const POST_MAX_ATTEMPTS = 2;

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= POST_MAX_ATTEMPTS; attempt++) {
    const result = await postToX(text);
    if (result.success) {
      appendLog(true, text, null);

      upsertTweetRecord(analyticsStore, {
        runId,
        tweetId: result.tweetId,
        postedAt: nowIso,
        dateContext: today,
        sport,
        angle,
        source: generationSource,
        status: POST_ENABLED ? "posted" : "dry_run",
        text,
        contentMode,
        newsUsed: newsContext.usedNews,
        newsQuery: newsContext.query,
        newsArticleTitle: newsContext.selectedArticle?.title,
        newsArticleUrl: newsContext.selectedArticle?.url,
        newsSourceName: newsContext.selectedArticle?.sourceName,
        newsPublishedAt: newsContext.selectedArticle?.publishedAt,
        trackedUrl: trackedUrl ?? undefined,
        linkTargetUrl: CLICK_TARGET_URL,
      });

      if (ANALYTICS_ENABLED && xClient && result.tweetId && POST_ENABLED) {
        try {
          await refreshMetricsForStore(analyticsStore, xClient, {
            lookbackDays: 1,
            minAgeMinutes: 0,
            maxTweets: 1,
          });
        } catch {
          // ignore immediate metrics failures
        }
      }

      pruneStore(analyticsStore);
      saveAnalyticsStore(analyticsStore, ANALYTICS_STORE_FILE);
      return 0;
    }

    lastError = result.error;
    const isRetryable =
      result.statusCode === 403 ||
      result.statusCode === 503 ||
      (result.error?.includes("403") ?? false) ||
      (result.error?.includes("503") ?? false);

    if (attempt < POST_MAX_ATTEMPTS && isRetryable) {
      console.warn("Post failed (attempt %d), retrying in %ds...", attempt, POST_RETRY_WAIT_MS / 1000);
      await new Promise((r) => setTimeout(r, POST_RETRY_WAIT_MS));
    } else {
      break;
    }
  }

  appendLog(false, text, lastError ?? null);
  upsertTweetRecord(analyticsStore, {
    runId,
    postedAt: nowIso,
    dateContext: today,
    sport,
    angle,
    source: generationSource,
    status: "failed",
    text,
    contentMode,
    newsUsed: newsContext.usedNews,
    newsQuery: newsContext.query,
    newsArticleTitle: newsContext.selectedArticle?.title,
    newsArticleUrl: newsContext.selectedArticle?.url,
    newsSourceName: newsContext.selectedArticle?.sourceName,
    newsPublishedAt: newsContext.selectedArticle?.publishedAt,
    trackedUrl: trackedUrl ?? undefined,
    linkTargetUrl: CLICK_TARGET_URL,
  });
  pruneStore(analyticsStore);
  saveAnalyticsStore(analyticsStore, ANALYTICS_STORE_FILE);

  console.error("Post failed:", lastError);
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    appendLog(false, null, String(err));
    process.exit(1);
  });
