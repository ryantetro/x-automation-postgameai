import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateConfig,
  POST_ENABLED,
  POST_TARGETS,
  POSTS_TO_THREADS,
  POSTS_TO_X,
  getSportForRun,
  getAngleForDate,
  LOGS_DIR,
  ANALYTICS_ENABLED,
  ANALYTICS_LOOKBACK_DAYS,
  ANALYTICS_MIN_AGE_MINUTES,
  ANALYTICS_MAX_REFRESH,
  TRACKING_BASE_URL,
  CLICK_TARGET_URL,
  MAX_POST_LEN,
} from "./config.js";
import { fetchSportsData } from "./fetchData.js";
import { fetchNewsContext } from "./fetchNews.js";
import { generatePost, fillFallbackTemplate } from "./generatePost.js";
import { isValidTweet } from "./validate.js";
import { getXClient, postToX } from "./postToX.js";
import { postToThreads } from "./postToThreads.js";
import {
  buildRecentContentDecision,
  selectContentDecision,
  type RecentContentDecision,
} from "./contentArchitecture.js";
import { getOpeningPattern } from "./contentHeuristics.js";
import { appendGenerationLog } from "./generationLog.js";
import {
  ANALYTICS_STORE_FILE,
  loadAnalyticsStore,
  saveAnalyticsStore,
  upsertTweetRecord,
  pruneStore,
  refreshMetricsForStore,
  refreshThreadsMetricsForStore,
  buildIterationInsights,
  formatInsightsReport,
  type PlatformPublishResult,
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
  if (next.length <= MAX_POST_LEN) return next;
  console.warn("Tracked link omitted because post body used the full character budget");
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

function readRecentContentDecisions(store: AnalyticsStore, cap: number): RecentContentDecision[] {
  return store.tweets
    .filter((tweet) => tweet.status === "posted" || tweet.status === "dry_run")
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, cap)
    .map((tweet) =>
      buildRecentContentDecision({
        frameId: tweet.contentFrameId,
        hookStructureId: tweet.hookStructureId,
        openingPattern: tweet.openingPattern,
        text: tweet.text,
        postedAt: tweet.postedAt,
      })
    );
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
    requireX: POST_ENABLED && POSTS_TO_X,
    requireThreads: POST_ENABLED && POSTS_TO_THREADS,
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
  const xClient = POSTS_TO_X ? getXClient() : null;

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

  if (ANALYTICS_ENABLED && POSTS_TO_THREADS) {
    try {
      const refreshed = await refreshThreadsMetricsForStore(analyticsStore, {
        lookbackDays: ANALYTICS_LOOKBACK_DAYS,
        minAgeMinutes: ANALYTICS_MIN_AGE_MINUTES,
        maxTweets: ANALYTICS_MAX_REFRESH,
      });
      if (refreshed.updated > 0 || refreshed.userInsightsUpdated) {
        console.info(
          `Threads analytics refreshed: ${refreshed.updated} post(s) updated (${refreshed.attempted} fetched)${
            refreshed.userInsightsUpdated ? ", user insights updated" : ""
          }`
        );
      }
    } catch (err) {
      console.warn("Threads analytics refresh skipped due to API error:", err);
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
  const recentContentDecisions = readRecentContentDecisions(analyticsStore, RECENT_TWEETS_CAP);
  const contentDecision = selectContentDecision({
    sport,
    date: today,
    targetPlatforms: [...POST_TARGETS],
    newsArticle: newsContext.selectedArticle,
    newsUsed: newsContext.usedNews,
    recentDecisions: recentContentDecisions,
  });

  let text: string | null = null;
  let generationSource = "llm";
  let openingPattern: string | undefined = contentDecision.openingPattern;
  let prePublishChecks:
    | {
        hookDetected: boolean;
        adviceDriftClear: boolean;
        openerVarietyClear: boolean;
      }
    | undefined;
  for (let attempt = 0; attempt < MAX_GENERATE_RETRIES; attempt++) {
    const generated = await generatePost(fetched, 1, {
      recentTweets: recentTexts,
      angle,
      date: today,
      iterationGuidance: insights?.promptGuidance,
      reserveChars,
      newsContext,
      contentDecision,
      recentContentDecisions,
    });
    for (const attemptLog of generated.attempts) {
      appendGenerationLog({
        runId,
        attemptId: attemptLog.attemptId,
        timestamp: nowIso,
        platformTargets: [...POST_TARGETS],
        sport,
        angle,
        contentFrameId: contentDecision.frameId,
        hookStructureId: contentDecision.hookStructureId,
        emotionTarget: contentDecision.emotionTarget,
        newsUsed: newsContext.usedNews,
        newsMomentType: contentDecision.newsMomentType,
        openingPattern: generated.openingPattern ?? contentDecision.openingPattern,
        rawOutput: attemptLog.rawOutput,
        cleanedOutput: attemptLog.cleanedOutput,
        passedChecks: attemptLog.passedChecks,
        failedChecks: attemptLog.failedChecks,
        rejectionReason: attemptLog.rejectionReason,
        acceptedForPublish: attemptLog.acceptedForPublish,
        usedFallback: false,
      });
    }
    text = generated.text;
    openingPattern = generated.openingPattern ?? openingPattern;
    prePublishChecks = generated.prePublishChecks ?? prePublishChecks;
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
    openingPattern = getOpeningPattern(text);
    appendGenerationLog({
      runId,
      attemptId: `${Date.now()}-fallback`,
      timestamp: new Date().toISOString(),
      platformTargets: [...POST_TARGETS],
      sport,
      angle,
      contentFrameId: contentDecision.frameId,
      hookStructureId: contentDecision.hookStructureId,
      emotionTarget: contentDecision.emotionTarget,
      newsUsed: newsContext.usedNews,
      newsMomentType: contentDecision.newsMomentType,
      openingPattern,
      cleanedOutput: text,
      passedChecks: [],
      failedChecks: ["fallback_used"],
      rejectionReason: "fallback_template",
      acceptedForPublish: true,
      usedFallback: true,
    });
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
      contentFrameId: contentDecision.frameId,
      contentFrameLabel: contentDecision.frameLabel,
      hookStructureId: contentDecision.hookStructureId,
      hookStructureLabel: contentDecision.hookStructureLabel,
      emotionTarget: contentDecision.emotionTarget,
      frameReason: contentDecision.frameReason,
      newsMomentType: contentDecision.newsMomentType,
      prePublishChecks,
      openingPattern,
      trackedUrl: trackedUrl ?? undefined,
      linkTargetUrl: CLICK_TARGET_URL,
    });
    pruneStore(analyticsStore);
    saveAnalyticsStore(analyticsStore, ANALYTICS_STORE_FILE);
    return 1;
  }

  const POST_RETRY_WAIT_MS = 8000;
  const POST_MAX_ATTEMPTS = 2;
  const isRetryableFailure = (statusCode?: number, error?: string): boolean =>
    statusCode === 403 ||
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504 ||
    (error?.includes("403") ?? false) ||
    (error?.includes("429") ?? false) ||
    (error?.includes("500") ?? false) ||
    (error?.includes("502") ?? false) ||
    (error?.includes("503") ?? false) ||
    (error?.includes("504") ?? false);

  async function publishWithRetry(
    platformLabel: "X" | "Threads",
    publish: () => Promise<{ success: boolean; error?: string; statusCode?: number; postId?: string }>
  ): Promise<{ success: boolean; error?: string; statusCode?: number; postId?: string }> {
    let lastResult: { success: boolean; error?: string; statusCode?: number; postId?: string } = {
      success: false,
      error: "Publish was not attempted",
    };

    for (let attempt = 1; attempt <= POST_MAX_ATTEMPTS; attempt++) {
      const result = await publish();
      if (result.success) return result;

      lastResult = result;
      if (attempt < POST_MAX_ATTEMPTS && isRetryableFailure(result.statusCode, result.error)) {
        console.warn(
          "%s post failed (attempt %d), retrying in %ds...",
          platformLabel,
          attempt,
          POST_RETRY_WAIT_MS / 1000
        );
        await new Promise((r) => setTimeout(r, POST_RETRY_WAIT_MS));
        continue;
      }

      break;
    }

    return lastResult;
  }

  const publishResults: PlatformPublishResult[] = [];

  if (POSTS_TO_X) {
    const result = await publishWithRetry("X", async () => {
      const xResult = await postToX(text);
      return {
        success: xResult.success,
        error: xResult.error,
        statusCode: xResult.statusCode,
        postId: xResult.tweetId,
      };
    });
    publishResults.push({
      platform: "x",
      status: result.success ? (POST_ENABLED ? "posted" : "dry_run") : "failed",
      postId: result.postId,
      statusCode: result.statusCode,
      error: result.error,
    });
  }

  if (POSTS_TO_THREADS) {
    const result = await publishWithRetry("Threads", async () => {
      const threadsResult = await postToThreads(text);
      return {
        success: threadsResult.success,
        error: threadsResult.error,
        statusCode: threadsResult.statusCode,
        postId: threadsResult.threadId,
      };
    });
    publishResults.push({
      platform: "threads",
      status: result.success ? (POST_ENABLED ? "posted" : "dry_run") : "failed",
      postId: result.postId,
      statusCode: result.statusCode,
      error: result.error,
    });
  }

  const xPublishResult = publishResults.find((result) => result.platform === "x");
  const threadsPublishResult = publishResults.find((result) => result.platform === "threads");
  const allSucceeded = publishResults.every((result) => result.status !== "failed");
  const anySucceeded = publishResults.some((result) => result.status !== "failed");
  const failureSummary = publishResults
    .filter((result) => result.status === "failed")
    .map((result) => `${result.platform}: ${result.error ?? "unknown error"}`)
    .join("; ");

  appendLog(allSucceeded, text, failureSummary || null);
  upsertTweetRecord(analyticsStore, {
    runId,
    tweetId: xPublishResult?.postId,
    threadsPostId: threadsPublishResult?.postId,
    postedAt: nowIso,
    dateContext: today,
    sport,
    angle,
    source: generationSource,
    status: POST_ENABLED ? (anySucceeded ? "posted" : "failed") : "dry_run",
    text,
    contentMode,
    newsUsed: newsContext.usedNews,
    newsQuery: newsContext.query,
    newsArticleTitle: newsContext.selectedArticle?.title,
    newsArticleUrl: newsContext.selectedArticle?.url,
    newsSourceName: newsContext.selectedArticle?.sourceName,
    newsPublishedAt: newsContext.selectedArticle?.publishedAt,
    contentFrameId: contentDecision.frameId,
    contentFrameLabel: contentDecision.frameLabel,
    hookStructureId: contentDecision.hookStructureId,
    hookStructureLabel: contentDecision.hookStructureLabel,
    emotionTarget: contentDecision.emotionTarget,
    frameReason: contentDecision.frameReason,
    newsMomentType: contentDecision.newsMomentType,
    prePublishChecks,
    openingPattern,
    trackedUrl: trackedUrl ?? undefined,
    linkTargetUrl: CLICK_TARGET_URL,
    publishTargets: [...POST_TARGETS],
    publishResults,
  });

  if (ANALYTICS_ENABLED && xClient && xPublishResult?.postId && xPublishResult.status === "posted") {
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
  if (ANALYTICS_ENABLED && POSTS_TO_THREADS && threadsPublishResult?.postId && threadsPublishResult.status === "posted") {
    try {
      await refreshThreadsMetricsForStore(analyticsStore, {
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

  if (allSucceeded) return 0;

  console.error("One or more platform posts failed:", failureSummary || "unknown error");
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    appendLog(false, null, String(err));
    process.exit(1);
  });
