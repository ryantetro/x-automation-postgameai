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
  DATA_SOURCE,
  IMAGE_ENABLED,
  BRAND_NAME,
  BRAND_WEBSITE,
  LOGS_DIR,
  ANALYTICS_ENABLED,
  ANALYTICS_LOOKBACK_DAYS,
  ANALYTICS_MIN_AGE_MINUTES,
  ANALYTICS_MAX_REFRESH,
  TRACKING_BASE_URL,
  CLICK_TARGET_URL,
  MAX_POST_LEN,
  STATE_DIR,
} from "./config.js";
import { fetchSportsData } from "./fetchData.js";
import { fetchNewsContext } from "./fetchNews.js";
import { generatePost, generatePostAnglesOnly, generateCanopyCandidateBatch, judgeCanopyCandidates, fillFallbackTemplate, pickNonDuplicateFallback, generateThread, isThreadDay } from "./generatePost.js";
import { isValidTweet } from "./validate.js";
import { getXClient, postToX, postToXWithMedia, postThreadToX } from "./postToX.js";
import { buildCampaignImagePromptForAngle, generateCampaignImage } from "./generateImage.js";
import { postToThreads } from "./postToThreads.js";
import {
  buildCanopyAgentLesson,
  buildCanopyAgentMemory,
  chooseCanopyAgentStrategy,
  chooseCanopyImageDirection,
  chooseCanopyImagePlan,
  formatCanopyAgentReport,
  rankCanopyCandidates,
  type CanopyStrategyEnvelope,
} from "./canopyAgent.js";
import {
  buildRecentContentDecision,
  selectContentDecision,
  findRetiredCombos,
  type RecentContentDecision,
} from "./contentArchitecture.js";
import { getOpeningPattern } from "./contentHeuristics.js";
import { appendGenerationLog } from "./generationLog.js";
import { loadPersonas, selectPersona, type Persona, type WeightAdjustment } from "./personaEngine.js";
import { enforceBrandMix, selectContentType } from "./contentMixer.js";
import { generateLesson, type LessonResult } from "./learningLoop.js";
import type { ContentTypeId } from "./contentTypeTemplates.js";
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
  type OutboundTrackingRecord,
} from "./analytics.js";

const MAX_GENERATE_RETRIES = 3;
const LOG_FILE = resolve(LOGS_DIR, "posts.log");
const ITERATION_REPORT_FILE = resolve(LOGS_DIR, "iteration-report.md");
const CANOPY_AGENT_REPORT_FILE = resolve(LOGS_DIR, "canopy-agent-report.md");
const RECENT_TWEETS_CAP = 60;

function buildTrackedUrl(trackingId: string): string | null {
  if (!TRACKING_BASE_URL) return null;
  const base = TRACKING_BASE_URL.replace(/\/+$/, "");
  return `${base}/r/${encodeURIComponent(trackingId)}`;
}

function appendTrackedUrl(text: string, trackedUrl: string | null): string {
  if (!trackedUrl) return text;
  const next = `${text.trim()} ${trackedUrl}`.trim();
  if (next.length <= MAX_POST_LEN) return next;
  console.warn("Tracked link omitted because post body used the full character budget");
  return text;
}

function appendTrackedUrlToThread(tweets: string[], trackedUrl: string | null): string[] {
  if (!trackedUrl || tweets.length === 0) return tweets;
  return tweets.map((tweet, index) => (index === 0 ? appendTrackedUrl(tweet, trackedUrl) : tweet));
}

function slugify(value: string, maxLength = 48): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function buildOutboundTrackingRecords(options: {
  runId: string;
  campaignSlug?: string;
  platforms: ("x" | "threads")[];
  dateContext: string;
  sport: string;
  angle: string;
  source: string;
  linkTargetUrl: string;
}): OutboundTrackingRecord[] {
  if (!TRACKING_BASE_URL || !options.linkTargetUrl) return [];

  const campaignSlug = options.campaignSlug?.trim() || "default";
  const campaignPrefix = (process.env.UTM_CAMPAIGN_PREFIX || "postgame_ai").trim() || "postgame_ai";
  const sportSlug = slugify(options.sport || "sports", 20) || "sports";
  const dateSlug = slugify(options.dateContext || "unknown", 20) || "unknown";
  const angleSlug = slugify(options.angle || "general", 40) || "general";
  const sourceSlug = slugify(options.source || "automation", 20) || "automation";

  return options.platforms.map((platform) => {
    const trackingId = `${options.runId}-${platform}`;
    return {
      trackingId,
      runId: options.runId,
      platform,
      campaignSlug: options.campaignSlug?.trim() || undefined,
      trackedUrl: buildTrackedUrl(trackingId)!,
      linkTargetUrl: options.linkTargetUrl,
      utmSource: platform,
      utmMedium: (process.env.UTM_MEDIUM || "social").trim() || "social",
      utmCampaign: `${campaignPrefix}_${campaignSlug}_${sportSlug}_${dateSlug}`,
      utmContent: trackingId,
      utmTerm: angleSlug,
      postSport: sportSlug,
      postSource: sourceSlug,
    };
  });
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
  const trackedUrlPreview = buildTrackedUrl(`${runId}-threads`);
  let linkToAppend = trackedUrlPreview || (CLICK_TARGET_URL || null);
  // When CLICK_TARGET_URL points to the same domain as BRAND_WEBSITE (e.g. "viciousshade.com")
  // the generated post body already includes the brand website, so appending the full URL
  // would duplicate it visually (e.g. "viciousshade.com https://www.viciousshade.com").
  // In that case, rely on the domain in the body and skip appending the explicit link.
  if (linkToAppend && BRAND_WEBSITE) {
    try {
      const website = BRAND_WEBSITE.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const host = new URL(linkToAppend).host.toLowerCase();
      if (host === website || host.endsWith(`.${website}`)) {
        linkToAppend = null;
      }
    } catch {
      // If CLICK_TARGET_URL is not a valid URL, keep linkToAppend as-is.
    }
  }
  const reserveChars = linkToAppend ? linkToAppend.length + 1 : 0;

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
  if (DATA_SOURCE === "angles_only") {
    try {
      mkdirSync(LOGS_DIR, { recursive: true });
      writeFileSync(CANOPY_AGENT_REPORT_FILE, `${formatCanopyAgentReport(buildCanopyAgentMemory(analyticsStore, new Date()))}\n`, "utf-8");
    } catch {
      // ignore report write issues
    }
  }

  let isThread = false;
  let threadTweets: string[] | null = null;
  let text: string | null = null;
  let generationSource = "llm";
  let openingPattern: string | undefined;
  let prePublishChecks:
    | {
        hookDetected: boolean;
        adviceDriftClear: boolean;
        openerVarietyClear: boolean;
      }
    | undefined;
  let sportForRecord = sport;
  let angleForRecord = angle;
  let contentMode: "sports_only" | "news_preferred" = "sports_only";
  let newsContext: Awaited<ReturnType<typeof fetchNewsContext>> = {
    usedNews: false,
    query: "",
    source: "newsapi",
    articles: [],
    selectedArticle: undefined,
    selectionReason: undefined,
  };
  let contentDecision: ReturnType<typeof selectContentDecision> = {
    frameId: "forty_eight_hour_window",
    frameLabel: "",
    hookStructureId: "scene_setter",
    hookStructureLabel: "",
    emotionTarget: "recognition",
    frameReason: "",
    newsMomentType: "unknown",
    openingPattern: "",
  };
  let canopyStrategy: CanopyStrategyEnvelope | undefined;
  let canopyIterationGuidance: string | undefined;
  let canopyCandidateBatchId: string | undefined;
  let canopySelectedCandidate:
    | {
        candidateId: string;
        candidateScore: number;
        candidateRank: number;
      }
    | undefined;
  let canopyImageSelectionReason: string | undefined;
  let canopyImageDetails:
    | {
        variantId: string;
        style: "lifestyle" | "mockup";
        shotType: "close_up" | "medium" | "wide";
        useCaseVertical?: string;
        productFocus?: string;
      }
    | undefined;

  let personaId: string | undefined;
  let selectedContentType: ContentTypeId | undefined;
  let brandMentionAllowed: boolean | undefined;
  let lessonVersion: string | undefined;
  let selectedPersona: Persona | undefined;

  // ── Campaign Slug (used by persona system and outbound tracking) ──
  const campaignSlug = process.env.CAMPAIGN?.trim() || undefined;

  // ── Persona System ──
  let lesson: LessonResult | undefined;
  let weightAdjustments: WeightAdjustment[] = [];
  const personasFile = campaignSlug ? loadPersonas(campaignSlug) : null;

  if (personasFile) {
    // Generate lesson from analytics
    const currentWeights = new Map(personasFile.personas.map((p) => [p.id, p.weight]));
    lesson = generateLesson(campaignSlug!, analyticsStore, currentWeights);
    weightAdjustments = lesson.weightAdjustments;
    lessonVersion = lesson.lessonVersion;
    console.info(`Learning loop: ${lesson.isColdStart ? "cold start" : "lesson generated"}`);
    if (lesson.weightAdjustments.length > 0) {
      console.info(`Weight adjustments: ${lesson.weightAdjustments.map((a) => `${a.personaId}: ${(a.oldWeight * 100).toFixed(0)}% -> ${(a.newWeight * 100).toFixed(0)}%`).join(", ")}`);
    }

    // Select persona
    const selection = selectPersona(personasFile, weightAdjustments);
    selectedPersona = selection.persona;
    personaId = selectedPersona.id;
    console.info(`Persona selected: ${selectedPersona.name} (${selectedPersona.id}, weight: ${(selection.adjustedWeight * 100).toFixed(0)}%)`);

    // Select content type
    const ctSelection = selectContentType(selectedPersona, [...POST_TARGETS], analyticsStore.tweets);
    selectedContentType = ctSelection.contentType;
    console.info(`Content type: ${selectedContentType} (${ctSelection.reason})`);

    // Enforce brand mix
    const brandDecision = enforceBrandMix(selectedPersona, analyticsStore.tweets);
    brandMentionAllowed = brandDecision.brandMentionAllowed;
    console.info(`Brand mention: ${brandMentionAllowed ? "allowed" : "suppressed"} (${brandDecision.reason})`);
  }

  if (DATA_SOURCE === "angles_only") {
    // Canopy / industry path: X-analytics-driven agent loop
    sportForRecord = "canopy";
    const canopyMemory = buildCanopyAgentMemory(analyticsStore, new Date());
    canopyStrategy = chooseCanopyAgentStrategy(analyticsStore, new Date());
    canopyIterationGuidance = buildCanopyAgentLesson(canopyMemory) || undefined;
    angleForRecord = canopyStrategy.angle;
    canopyCandidateBatchId = `${runId}:canopy-batch`;
    const recentTexts = readRecentTweetTexts(analyticsStore, RECENT_TWEETS_CAP);
    const rawCandidates = await generateCanopyCandidateBatch({
      angle: angleForRecord,
      date: today,
      recentTweets: recentTexts,
      reserveChars,
      iterationGuidance: canopyIterationGuidance
        ? `${canopyIterationGuidance}${lesson ? `\n\n${lesson.lessonText}` : ""}`
        : lesson?.lessonText,
      strategy: canopyStrategy,
      count: 7,
      persona: selectedPersona,
      contentTypeId: selectedContentType,
      brandMentionAllowed,
    });
    const ranked = rankCanopyCandidates(rawCandidates, canopyStrategy);
    const finalists = ranked.slice(0, 4);
    const judged = await judgeCanopyCandidates(canopyStrategy, finalists);
    const judgedMap = new Map(judged.map((row) => [row.candidateId, row.judgeScore]));
    const finalRanked = ranked
      .map((row) => ({
        ...row,
        judgeScore: judgedMap.get(row.candidateId) ?? 0,
        totalScore: row.totalScore + (judgedMap.get(row.candidateId) ?? 0) * 0.6,
      }))
      .sort((a, b) => b.totalScore - a.totalScore || a.rank - b.rank)
      .map((row, index) => ({ ...row, rank: index + 1 }));
    const selected = finalRanked.find((row) => !isDuplicate(row.text, recentTexts)) ?? finalRanked[0];
    text = selected?.text ?? null;
    canopySelectedCandidate = selected
      ? {
          candidateId: selected.candidateId,
          candidateScore: Number(selected.totalScore.toFixed(2)),
          candidateRank: selected.rank,
        }
      : undefined;
    if (!text || !isValidTweet(text, { requireBrand: false })) {
      text = `Event season is brutal on gear. What holds up is what gets reordered. ${BRAND_NAME} · ${BRAND_WEBSITE}`.slice(
        0,
        MAX_POST_LEN - (reserveChars + 1)
      ).trim();
      if (!text.includes(BRAND_WEBSITE)) text += ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;
      generationSource = "fallback";
    }
    // Strip brand from fallback if persona/80-20 says no brand
    if (brandMentionAllowed === false && text) {
      text = text
        .replace(` — ${BRAND_NAME} · ${BRAND_WEBSITE}`, "")
        .replace(`${BRAND_NAME} · ${BRAND_WEBSITE}`, "")
        .trim();
    }
    openingPattern = text ? getOpeningPattern(text) : undefined;
    for (const candidate of (text ? finalRanked : [])) {
      appendGenerationLog({
        runId,
        attemptId: `${Date.now()}-${candidate.candidateId}`,
        timestamp: nowIso,
        platformTargets: [...POST_TARGETS],
        sport: sportForRecord,
        angle: angleForRecord,
        newsUsed: false,
        openingPattern: getOpeningPattern(candidate.text),
        cleanedOutput: candidate.text,
        passedChecks: candidate.rank <= 3 ? ["candidate_finalist"] : [],
        failedChecks: candidate.rank <= 3 ? [] : ["candidate_not_selected"],
        rejectionReason: candidate.rank <= 3 ? undefined : "candidate_ranked_below_threshold",
        acceptedForPublish: canopySelectedCandidate?.candidateId === candidate.candidateId,
        usedFallback: generationSource === "fallback",
        campaignStrategyId: canopyStrategy?.pillarId,
        voiceFamily: canopyStrategy?.voiceFamily,
        buyerIntentLevel: canopyStrategy?.buyerIntentLevel,
        useCaseVertical: canopyStrategy?.useCaseVertical,
        productFocus: canopyStrategy?.productFocus,
        urgencyMode: canopyStrategy?.urgencyMode,
        ctaMode: canopyStrategy?.ctaMode,
        creativeDirection: canopyStrategy?.creativeDirection,
        optimizerVersion: canopyStrategy?.optimizerVersion,
        selectionReason: canopyStrategy?.selectionReason,
        seriesId: canopyStrategy?.seriesId,
        contentBucket: canopyStrategy?.contentBucket,
        brandTagIncluded: candidate.text.includes(BRAND_NAME) || candidate.text.includes(BRAND_WEBSITE),
        brandTagPolicy: canopyStrategy?.brandTagPolicy,
        candidateId: candidate.candidateId,
        candidateBatchId: canopyCandidateBatchId,
        candidateScore: Number(candidate.totalScore.toFixed(2)),
        candidateRank: candidate.rank,
        candidateRejectionReason: canopySelectedCandidate?.candidateId === candidate.candidateId ? undefined : "ranked_lower_than_winner",
        selectedForPublish: canopySelectedCandidate?.candidateId === candidate.candidateId,
        agentMode: canopyStrategy?.agentMode,
        strategyEnvelopeId: canopyStrategy?.id,
        agentReasoningSummary: canopyStrategy?.agentReasoningSummary,
        performanceWindowLabel: canopyStrategy?.performanceWindowLabel,
        personaId,
        contentType: selectedContentType,
        brandMentioned: !!candidate.text && (candidate.text.includes(BRAND_NAME) || candidate.text.includes(BRAND_WEBSITE)),
        lessonVersion,
        lessonText: lesson?.lessonText,
      });
    }
  } else {
    // Sports path (existing)
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

    const newsCtx = await fetchNewsContext(sport);
    newsContext = newsCtx;
    contentMode = newsContext.usedNews ? "news_preferred" : "sports_only";
    if (newsContext.selectionReason) {
      console.info(`News selection (${contentMode}): ${newsContext.selectionReason}`);
    }

    let recentTexts = readRecentTweetTexts(analyticsStore, RECENT_TWEETS_CAP);
    const recentContentDecisions = readRecentContentDecisions(analyticsStore, RECENT_TWEETS_CAP);

    // Auto-retire underperforming frame/hook combos
    const retiredCombos = findRetiredCombos(analyticsStore.tweets);
    if (retiredCombos.length > 0) {
      console.info(`Auto-retired ${retiredCombos.length} underperforming combo(s): ${retiredCombos.map((rc) => `${rc.frameId}+${rc.hookStructureId} (avg ${rc.avgScore} vs overall ${rc.overallAvgScore})`).join(", ")}`);
    }

    const decision = selectContentDecision({
      sport,
      date: today,
      targetPlatforms: [...POST_TARGETS],
      newsArticle: newsContext.selectedArticle,
      newsUsed: newsContext.usedNews,
      recentDecisions: recentContentDecisions,
      retiredCombos,
      hookScores: insights?.hookScores,
    });
    contentDecision = decision;

    // Try thread generation on thread days (Wed/Sat) for sports campaigns
    if (isThreadDay() && POSTS_TO_X && DATA_SOURCE === "sports") {
      console.info("Thread day detected — attempting thread generation");
      const threadResult = await generateThread({
        sport,
        angle,
        date: today,
        recentTweets: recentTexts.slice(0, 6),
        iterationGuidance: insights?.promptGuidance,
      });
      if (threadResult.tweets && threadResult.tweets.length >= 2) {
        threadTweets = threadResult.tweets;
        isThread = true;
        text = threadTweets[0]; // Use first tweet as the "text" for analytics
        generationSource = "llm_thread";
        console.info(`Thread generated: ${threadTweets.length} tweets`);
      } else {
        console.info("Thread generation failed; falling back to single post");
      }
    }

    // Pull top-performing post texts to feed as style examples
    const winningPostTexts = insights?.winners
      ?.slice(0, 3)
      .map((w) => w.text)
      .filter((t) => t && t.length > 0) ?? [];

    // Skip single-post generation if thread was already generated
    if (isThread && threadTweets) {
      // Thread already generated above; skip to publish
    } else for (let attempt = 0; attempt < MAX_GENERATE_RETRIES; attempt++) {
      const generated = await generatePost(fetched, 1, {
        recentTweets: recentTexts,
        angle,
        date: today,
        iterationGuidance: insights?.promptGuidance
          ? `${insights.promptGuidance}${lesson ? `\n\n${lesson.lessonText}` : ""}`
          : lesson?.lessonText,
        reserveChars,
        newsContext,
        contentDecision: decision,
        recentContentDecisions,
        winningPostTexts,
        persona: selectedPersona,
        contentTypeId: selectedContentType,
        brandMentionAllowed,
      });
      for (const attemptLog of generated.attempts) {
        appendGenerationLog({
          runId,
          attemptId: attemptLog.attemptId,
          timestamp: nowIso,
          platformTargets: [...POST_TARGETS],
          sport,
          angle,
          contentFrameId: decision.frameId,
          hookStructureId: decision.hookStructureId,
          emotionTarget: decision.emotionTarget,
          newsUsed: newsContext.usedNews,
          newsMomentType: decision.newsMomentType,
          openingPattern: generated.openingPattern ?? decision.openingPattern,
          rawOutput: attemptLog.rawOutput,
          cleanedOutput: attemptLog.cleanedOutput,
          passedChecks: attemptLog.passedChecks,
          failedChecks: attemptLog.failedChecks,
          rejectionReason: attemptLog.rejectionReason,
          acceptedForPublish: attemptLog.acceptedForPublish,
          usedFallback: false,
          personaId,
          contentType: selectedContentType,
          brandMentioned: !!attemptLog.cleanedOutput && (attemptLog.cleanedOutput.includes(BRAND_NAME) || attemptLog.cleanedOutput.includes(BRAND_WEBSITE)),
          lessonVersion,
          lessonText: lesson?.lessonText,
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
      const recentTextsFallback = readRecentTweetTexts(analyticsStore, RECENT_TWEETS_CAP);
      const fallbackCandidate = pickNonDuplicateFallback(fetched.sport ?? "nba", fetched, recentTextsFallback, { reserveChars, angle });
      if (!fallbackCandidate) {
        console.info("Skipping post: all fallback templates are duplicates of recent posts");
        appendLog(true, null, "Skipped: all fallbacks duplicate");
        pruneStore(analyticsStore);
        saveAnalyticsStore(analyticsStore, ANALYTICS_STORE_FILE);
        return 0;
      }
      text = fallbackCandidate;
      generationSource = "fallback";
      // Strip brand from fallback if persona/80-20 says no brand
      if (brandMentionAllowed === false && text) {
        text = text
          .replace(` — ${BRAND_NAME} · ${BRAND_WEBSITE}`, "")
          .replace(`${BRAND_NAME} · ${BRAND_WEBSITE}`, "")
          .trim();
      }
      openingPattern = getOpeningPattern(text);
      appendGenerationLog({
        runId,
        attemptId: `${Date.now()}-fallback`,
        timestamp: new Date().toISOString(),
        platformTargets: [...POST_TARGETS],
        sport,
        angle,
        contentFrameId: decision.frameId,
        hookStructureId: decision.hookStructureId,
        emotionTarget: decision.emotionTarget,
        newsUsed: newsContext.usedNews,
        newsMomentType: decision.newsMomentType,
        openingPattern,
        cleanedOutput: text,
        passedChecks: [],
        failedChecks: ["fallback_used"],
        rejectionReason: "fallback_template",
        acceptedForPublish: true,
        usedFallback: true,
        personaId,
        contentType: selectedContentType,
        brandMentioned: !!text && (text.includes(BRAND_NAME) || text.includes(BRAND_WEBSITE)),
        lessonVersion,
      });
    }
  }

  const outboundTracking = buildOutboundTrackingRecords({
    runId,
    campaignSlug,
    platforms: [...POST_TARGETS],
    dateContext: today,
    sport: sportForRecord,
    angle: angleForRecord,
    source: generationSource,
    linkTargetUrl: CLICK_TARGET_URL,
  });
  const trackingByPlatform = new Map(outboundTracking.map((record) => [record.platform, record] as const));
  const xText = POSTS_TO_X ? appendTrackedUrl(text, trackingByPlatform.get("x")?.trackedUrl ?? linkToAppend) : null;
  const threadsText = POSTS_TO_THREADS ? appendTrackedUrl(text, trackingByPlatform.get("threads")?.trackedUrl ?? linkToAppend) : null;
  const xThreadTweets = isThread && threadTweets ? appendTrackedUrlToThread(threadTweets, trackingByPlatform.get("x")?.trackedUrl ?? linkToAppend) : null;
  text = xText ?? threadsText ?? appendTrackedUrl(text, linkToAppend);

  let imageBuffer: Buffer | null = null;
  if (DATA_SOURCE === "angles_only" && IMAGE_ENABLED) {
    const imagePlan = canopyStrategy ? chooseCanopyImagePlan(analyticsStore, canopyStrategy, new Date()) : { enabled: true, reason: "No canopy strategy available, so defaulting to image-on." };
    canopyImageSelectionReason = imagePlan.reason;
    const preferredImage = canopyStrategy && imagePlan.enabled ? chooseCanopyImageDirection(analyticsStore, canopyStrategy, new Date()) : null;
    if (POST_ENABLED && imagePlan.enabled) {
      const generatedImage = await generateCampaignImage(angleForRecord, {
        store: analyticsStore,
        date: new Date(),
        pillarId: canopyStrategy?.pillarId,
        preferredVariantId: preferredImage?.variantId,
        preferredStyle: preferredImage?.style,
        preferredShotType: preferredImage?.shotType,
        preferredUseCaseVertical: canopyStrategy?.useCaseVertical,
        preferredProductFocus: canopyStrategy?.productFocus,
      });
      imageBuffer = generatedImage.buffer;
      canopyImageSelectionReason = [canopyImageSelectionReason, generatedImage.details?.selectionReason].filter(Boolean).join("; ") || undefined;
      canopyImageDetails = generatedImage.details
        ? {
            variantId: generatedImage.details.variantId,
            style: generatedImage.details.style,
            shotType: generatedImage.details.shotType,
            useCaseVertical: generatedImage.details.useCaseVertical,
            productFocus: generatedImage.details.productFocus,
          }
        : undefined;
      if (!imageBuffer) console.warn("Campaign image generation failed; posting text only.");
    } else if (!POST_ENABLED && imagePlan.enabled) {
      console.info("Dry run: would generate campaign image for angle");
      const promptDetails = buildCampaignImagePromptForAngle(angleForRecord, {
        store: analyticsStore,
        date: new Date(),
        pillarId: canopyStrategy?.pillarId,
        preferredVariantId: preferredImage?.variantId,
        preferredStyle: preferredImage?.style,
        preferredShotType: preferredImage?.shotType,
        preferredUseCaseVertical: canopyStrategy?.useCaseVertical,
        preferredProductFocus: canopyStrategy?.productFocus,
      });
      canopyImageSelectionReason = [canopyImageSelectionReason, promptDetails?.selectionReason].filter(Boolean).join("; ") || undefined;
      canopyImageDetails = promptDetails
        ? {
            variantId: promptDetails.variantId,
            style: promptDetails.style,
            shotType: promptDetails.shotType,
            useCaseVertical: promptDetails.useCaseVertical,
            productFocus: promptDetails.productFocus,
          }
        : undefined;
    } else {
      console.info(`Canopy image skipped: ${imagePlan.reason}`);
    }
  }

  const recentTextsFinal = readRecentTweetTexts(analyticsStore, RECENT_TWEETS_CAP);
  const validateOpts = DATA_SOURCE === "angles_only" || brandMentionAllowed === false
    ? { requireBrand: false }
    : undefined;
  if (
    generationSource === "fallback" &&
    text &&
    isValidTweet(text, validateOpts) &&
    isDuplicate(text, recentTextsFinal)
  ) {
    console.info("Skipping post: fallback is duplicate of recent post (X would reject with 403)");
    appendLog(true, null, "Skipped duplicate fallback");
    return 0;
  }

  if (!isValidTweet(text, validateOpts)) {
    console.error("Final text still invalid (length or missing brand); aborting");
    appendLog(false, text, "Validation failed");
    upsertTweetRecord(analyticsStore, {
      runId,
      postedAt: nowIso,
      postedHour: new Date(nowIso).getUTCHours(),
      dateContext: today,
      sport: sportForRecord,
      angle: angleForRecord,
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
      trackedUrl: outboundTracking[0]?.trackedUrl ?? linkToAppend ?? undefined,
      linkTargetUrl: CLICK_TARGET_URL,
      outboundTracking,
      hasImage: false,
      campaignStrategyId: canopyStrategy?.pillarId,
      voiceFamily: canopyStrategy?.voiceFamily,
      buyerIntentLevel: canopyStrategy?.buyerIntentLevel,
      useCaseVertical: canopyStrategy?.useCaseVertical,
      productFocus: canopyStrategy?.productFocus,
      urgencyMode: canopyStrategy?.urgencyMode,
      ctaMode: canopyStrategy?.ctaMode,
      creativeDirection: canopyStrategy?.creativeDirection,
      imageConceptId: canopyImageDetails?.variantId,
      imageStyleFamily: canopyImageDetails?.style,
      imageShotType: canopyImageDetails?.shotType,
      optimizerVersion: canopyStrategy?.optimizerVersion,
      selectionReason: [canopyStrategy?.selectionReason, canopyImageSelectionReason].filter(Boolean).join("; ") || undefined,
      seriesId: canopyStrategy?.seriesId,
      contentBucket: canopyStrategy?.contentBucket,
      brandTagIncluded: !!text && (text.includes(BRAND_NAME) || text.includes(BRAND_WEBSITE)),
      candidateId: canopySelectedCandidate?.candidateId,
      candidateBatchId: canopyCandidateBatchId,
      candidateScore: canopySelectedCandidate?.candidateScore,
      candidateRank: canopySelectedCandidate?.candidateRank,
      selectedForPublish: true,
      agentMode: canopyStrategy?.agentMode,
      strategyEnvelopeId: canopyStrategy?.id,
      agentReasoningSummary: canopyStrategy?.agentReasoningSummary,
      performanceWindowLabel: canopyStrategy?.performanceWindowLabel,
      personaId,
      contentType: selectedContentType,
      brandMentioned: !!text && (text.includes(BRAND_NAME) || text.includes(BRAND_WEBSITE)),
      lessonVersion,
    });
    pruneStore(analyticsStore);
    saveAnalyticsStore(analyticsStore, ANALYTICS_STORE_FILE);
    return 1;
  }

  const hasImageForRecord = !!imageBuffer;

  if (!POST_ENABLED && text) {
    console.info("\n--- Example tweet (full) ---\n" + text + "\n---\n");
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
      let xResult;
      if (isThread && threadTweets && threadTweets.length >= 2) {
        xResult = await postThreadToX(xThreadTweets ?? threadTweets);
      } else if (imageBuffer != null) {
        xResult = await postToXWithMedia(xText ?? text, imageBuffer, "image/png");
      } else {
        xResult = await postToX(xText ?? text);
      }
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
      const threadsResult = await postToThreads(threadsText ?? text);
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
  const outboundTrackingWithPostIds = outboundTracking.map((record) => ({
    ...record,
    publishedPostId:
      record.platform === "x"
        ? xPublishResult?.postId
        : record.platform === "threads"
          ? threadsPublishResult?.postId
          : undefined,
  }));
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
    postedHour: new Date(nowIso).getUTCHours(),
    dateContext: today,
    sport: sportForRecord,
    angle: angleForRecord,
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
    trackedUrl: outboundTrackingWithPostIds[0]?.trackedUrl ?? linkToAppend ?? undefined,
    linkTargetUrl: CLICK_TARGET_URL,
    outboundTracking: outboundTrackingWithPostIds,
    publishTargets: [...POST_TARGETS],
    publishResults,
    hasImage: hasImageForRecord,
    campaignStrategyId: canopyStrategy?.pillarId,
    voiceFamily: canopyStrategy?.voiceFamily,
    buyerIntentLevel: canopyStrategy?.buyerIntentLevel,
    useCaseVertical: canopyStrategy?.useCaseVertical ?? canopyImageDetails?.useCaseVertical,
    productFocus: canopyStrategy?.productFocus ?? canopyImageDetails?.productFocus,
    urgencyMode: canopyStrategy?.urgencyMode,
    ctaMode: canopyStrategy?.ctaMode,
    creativeDirection: canopyStrategy?.creativeDirection,
    imageConceptId: canopyImageDetails?.variantId,
    imageStyleFamily: canopyImageDetails?.style,
    imageShotType: canopyImageDetails?.shotType,
    optimizerVersion: canopyStrategy?.optimizerVersion,
    selectionReason: [canopyStrategy?.selectionReason, canopyImageSelectionReason].filter(Boolean).join("; ") || undefined,
    seriesId: canopyStrategy?.seriesId,
    contentBucket: canopyStrategy?.contentBucket,
    brandTagIncluded: !!text && (text.includes(BRAND_NAME) || text.includes(BRAND_WEBSITE)),
    candidateId: canopySelectedCandidate?.candidateId,
    candidateBatchId: canopyCandidateBatchId,
    candidateScore: canopySelectedCandidate?.candidateScore,
    candidateRank: canopySelectedCandidate?.candidateRank,
    selectedForPublish: true,
    agentMode: canopyStrategy?.agentMode,
    strategyEnvelopeId: canopyStrategy?.id,
    agentReasoningSummary: canopyStrategy?.agentReasoningSummary,
    performanceWindowLabel: canopyStrategy?.performanceWindowLabel,
    personaId,
    contentType: selectedContentType,
    brandMentioned: !!text && (text.includes(BRAND_NAME) || text.includes(BRAND_WEBSITE)),
    lessonVersion,
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
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    appendLog(false, null, String(err));
    process.exit(1);
  });
