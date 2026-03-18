import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TwitterApi } from "twitter-api-v2";
import { ANALYTICS_STORE_FILENAME, STATE_DIR, THREADS_ACCESS_TOKEN } from "./config.js";
import type {
  ContentFrameId,
  EmotionTarget,
  HookStructureId,
  NewsMomentType,
} from "./contentArchitecture.js";
import { FRAME_DEFINITIONS, HOOK_DEFINITIONS } from "./contentArchitecture.js";

export const ANALYTICS_STORE_FILE = resolve(STATE_DIR, ANALYTICS_STORE_FILENAME);
const STORE_VERSION = 5;

export type TweetStatus = "posted" | "dry_run" | "failed";
export type ContentMode = "sports_only" | "news_preferred";
export type PublishPlatform = "x" | "threads";
export type AnalyticsPlatformStatus = "healthy" | "degraded" | "blocked";
export type CanopyVoiceFamily =
  | "observational_thought_leadership"
  | "contrarian_take"
  | "buyer_intent_detail"
  | "micro_story"
  | "deadline_urgency"
  | "soft_commercial";
export type CanopyBuyerIntentLevel = "awareness" | "consideration" | "purchase_intent";
export type CanopyUrgencyMode = "none" | "seasonal" | "rush_order" | "replacement";
export type CanopyCtaMode = "none" | "soft_commercial" | "question_led";
export type CanopySeriesId =
  | "vendor_life"
  | "booth_hot_take"
  | "booth_identity"
  | "proof_in_the_wild"
  | "utah_event_radar";
export type CanopyContentBucket = "culture" | "education" | "community" | "promo";
export type CanopyBrandTagPolicy = "none" | "optional" | "soft_commercial";
export type CanopyImageStyleFamily = "lifestyle" | "mockup";
export type CanopyImageShotType = "close_up" | "medium" | "wide";
export type CanopyAgentMode = "exploit" | "explore";

export interface AnalyticsPlatformHealth {
  status: AnalyticsPlatformStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastErrorCode?: string;
}

export interface TweetAnalyticsFetchState {
  status: "ok" | "error" | "skipped";
  updatedAt: string;
  reason?: string;
  permanent?: boolean;
  failures?: number;
}

export interface PrePublishChecks {
  hookDetected: boolean;
  adviceDriftClear: boolean;
  openerVarietyClear: boolean;
}

export interface PlatformPublishResult {
  platform: PublishPlatform;
  status: TweetStatus;
  postId?: string;
  statusCode?: number;
  error?: string;
}

export interface TweetMetricsSnapshot {
  platform?: PublishPlatform;
  fetchedAt: string;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  quoteCount: number;
  bookmarkCount: number;
  shareCount?: number;
  impressionCount: number | null;
  engagementCount: number;
  engagementRate: number | null;
}

export interface ClickMetricsSnapshot {
  fetchedAt: string;
  totalClicks: number;
  uniqueClicks: number;
}

export interface TrafficMetricsSnapshot {
  fetchedAt: string;
  landingVisits: number;
  uniqueVisitors: number;
  sessions: number;
  engagedSessions: number;
  signupsStarted: number;
  signupsCompleted: number;
  demoBookings: number;
  trialStarts: number;
  purchases: number;
}

export interface OutboundTrackingRecord {
  trackingId: string;
  runId: string;
  platform: PublishPlatform;
  campaignSlug?: string;
  trackedUrl: string;
  linkTargetUrl: string;
  publishedPostId?: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  postSport?: string;
  postSource?: string;
  clickMetrics?: ClickMetricsSnapshot;
  trafficMetrics?: TrafficMetricsSnapshot;
}

export interface ThreadsLinkClickValue {
  linkUrl: string;
  value: number;
}

export interface ThreadsUserInsightsSnapshot {
  fetchedAt: string;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  clicks: number | null;
  followersCount: number | null;
  clicksByUrl: ThreadsLinkClickValue[];
}

export interface TweetAnalyticsRecord {
  runId: string;
  tweetId?: string;
  threadsPostId?: string;
  postedAt: string;
  dateContext: string;
  sport: string;
  angle: string;
  source: string;
  status: TweetStatus;
  text: string;
  contentMode?: ContentMode;
  newsUsed?: boolean;
  newsQuery?: string;
  newsArticleTitle?: string;
  newsArticleUrl?: string;
  newsSourceName?: string;
  newsPublishedAt?: string;
  contentFrameId?: ContentFrameId;
  contentFrameLabel?: string;
  hookStructureId?: HookStructureId;
  hookStructureLabel?: string;
  emotionTarget?: EmotionTarget;
  frameReason?: string;
  newsMomentType?: NewsMomentType;
  prePublishChecks?: PrePublishChecks;
  openingPattern?: string;
  trackedUrl?: string;
  linkTargetUrl?: string;
  outboundTracking?: OutboundTrackingRecord[];
  publishTargets?: PublishPlatform[];
  publishResults?: PlatformPublishResult[];
  metrics?: TweetMetricsSnapshot;
  clickMetrics?: ClickMetricsSnapshot;
  trafficMetrics?: TrafficMetricsSnapshot;
  score?: number;
  scoreUpdatedAt?: string;
  /** True when the post included an AI-generated image (e.g. canopy). */
  hasImage?: boolean;
  analyticsFetchState?: Partial<Record<PublishPlatform, TweetAnalyticsFetchState>>;
  campaignStrategyId?: string;
  voiceFamily?: CanopyVoiceFamily;
  buyerIntentLevel?: CanopyBuyerIntentLevel;
  useCaseVertical?: string;
  productFocus?: string;
  urgencyMode?: CanopyUrgencyMode;
  ctaMode?: CanopyCtaMode;
  imageConceptId?: string;
  imageStyleFamily?: CanopyImageStyleFamily;
  imageShotType?: CanopyImageShotType;
  optimizerVersion?: string;
  selectionReason?: string;
  creativeDirection?: string;
  candidateId?: string;
  candidateBatchId?: string;
  candidateScore?: number;
  candidateRank?: number;
  candidateRejectionReason?: string;
  selectedForPublish?: boolean;
  agentMode?: CanopyAgentMode;
  strategyEnvelopeId?: string;
  agentReasoningSummary?: string;
  performanceWindowLabel?: string;
  seriesId?: CanopySeriesId;
  contentBucket?: CanopyContentBucket;
  brandTagIncluded?: boolean;
}

export interface AnalyticsStore {
  version: number;
  updatedAt: string;
  tweets: TweetAnalyticsRecord[];
  threadsUserInsights?: ThreadsUserInsightsSnapshot;
  analyticsHealth?: Partial<Record<PublishPlatform, AnalyticsPlatformHealth>>;
}

export interface RefreshOptions {
  lookbackDays: number;
  minAgeMinutes: number;
  maxTweets: number;
}

export interface IterationInsights {
  sampleSize: number;
  winners: TweetAnalyticsRecord[];
  losers: TweetAnalyticsRecord[];
  winnerPatterns: string[];
  avoidPatterns: string[];
  topWinnerHashtags: string[];
  promptGuidance: string;
  contentModeStats: Array<{
    contentMode: ContentMode;
    count: number;
    avgImpressions: number;
    avgClicks: number;
  }>;
  newsSourceStats: Array<{
    sourceName: string;
    count: number;
    avgImpressions: number;
    avgClicks: number;
  }>;
  topFramesByPlatform: Array<{
    platform: PublishPlatform;
    frameId: ContentFrameId;
    frameLabel: string;
    count: number;
    avgScore: number;
  }>;
  topHooksByPlatform: Array<{
    platform: PublishPlatform;
    hookStructureId: HookStructureId;
    hookStructureLabel: string;
    count: number;
    avgScore: number;
  }>;
  topFrameHookPairs: Array<{
    platform: PublishPlatform;
    frameId: ContentFrameId;
    hookStructureId: HookStructureId;
    count: number;
    avgScore: number;
  }>;
  topEmotionsByPlatform: Array<{
    platform: PublishPlatform;
    emotionTarget: EmotionTarget;
    count: number;
    avgScore: number;
  }>;
  avoidOpeners: string[];
  preferredEmotionByPlatform: Array<{
    platform: PublishPlatform;
    emotionTarget: EmotionTarget;
  }>;
}

export interface GenerationInsightSummary {
  mostCommonFailedChecks: Array<{ check: string; count: number }>;
  rewriteReasons: Array<{ reason: string; count: number }>;
  frameHookFailures: Array<{ frameId: ContentFrameId; hookStructureId: HookStructureId; count: number }>;
  threadsLengthFailures: Array<{ hookStructureId: HookStructureId; count: number }>;
  fallbackFrames: Array<{ frameId: ContentFrameId; count: number }>;
}

export function defaultStore(): AnalyticsStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    tweets: [],
    analyticsHealth: {},
  };
}

export function loadAnalyticsStore(path = ANALYTICS_STORE_FILE): AnalyticsStore {
  if (!existsSync(path)) return defaultStore();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AnalyticsStore>;
    const tweets = Array.isArray(parsed.tweets) ? parsed.tweets : [];
    return {
      version: typeof parsed.version === "number" ? parsed.version : STORE_VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      tweets,
      analyticsHealth:
        parsed.analyticsHealth && typeof parsed.analyticsHealth === "object"
          ? (parsed.analyticsHealth as Partial<Record<PublishPlatform, AnalyticsPlatformHealth>>)
          : {},
      threadsUserInsights:
        parsed.threadsUserInsights && typeof parsed.threadsUserInsights === "object"
          ? (parsed.threadsUserInsights as ThreadsUserInsightsSnapshot)
          : undefined,
    };
  } catch {
    return defaultStore();
  }
}

export function saveAnalyticsStore(store: AnalyticsStore, path = ANALYTICS_STORE_FILE): void {
  const next: AnalyticsStore = {
    ...store,
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

export function upsertTweetRecord(store: AnalyticsStore, record: TweetAnalyticsRecord): void {
  if (record.tweetId) {
    const byTweetId = store.tweets.findIndex((t) => t.tweetId === record.tweetId);
    if (byTweetId >= 0) {
      store.tweets[byTweetId] = { ...store.tweets[byTweetId], ...record };
      return;
    }
  }
  if (record.threadsPostId) {
    const byThreadsId = store.tweets.findIndex((t) => t.threadsPostId === record.threadsPostId);
    if (byThreadsId >= 0) {
      store.tweets[byThreadsId] = { ...store.tweets[byThreadsId], ...record };
      return;
    }
  }
  const byRunId = store.tweets.findIndex((t) => t.runId === record.runId);
  if (byRunId >= 0) {
    store.tweets[byRunId] = { ...store.tweets[byRunId], ...record };
    return;
  }
  store.tweets.push(record);
}

export function pruneStore(store: AnalyticsStore, maxRecords = 600): void {
  if (store.tweets.length <= maxRecords) return;
  store.tweets.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  store.tweets = store.tweets.slice(0, maxRecords);
}

function toNumberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function computeScore(metrics: TweetMetricsSnapshot): number {
  const impressions = metrics.impressionCount ?? 0;
  const likes = metrics.likeCount;
  const replies = metrics.replyCount;
  const retweets = metrics.retweetCount;
  const bookmarks = metrics.bookmarkCount;
  const quotes = metrics.quoteCount;

  // Weighted engagement formula that values impressions as a baseline signal
  const score =
    impressions * 1 +
    likes * 20 +
    replies * 30 +
    retweets * 25 +
    bookmarks * 15 +
    quotes * 20;

  return Number(score.toFixed(4));
}

function parseTweetMetrics(row: Record<string, unknown>): TweetMetricsSnapshot {
  const now = new Date().toISOString();
  const publicMetrics = (row.public_metrics as Record<string, unknown> | undefined) ?? {};
  const organicMetrics = (row.organic_metrics as Record<string, unknown> | undefined) ?? {};
  const nonPublicMetrics = (row.non_public_metrics as Record<string, unknown> | undefined) ?? {};

  const likeCount = toNumberOrZero(publicMetrics.like_count);
  const replyCount = toNumberOrZero(publicMetrics.reply_count);
  const retweetCount = toNumberOrZero(publicMetrics.retweet_count);
  const quoteCount = toNumberOrZero(publicMetrics.quote_count);
  const bookmarkCount = toNumberOrZero(publicMetrics.bookmark_count);

  const impressionCandidate =
    nonPublicMetrics.impression_count ??
    organicMetrics.impression_count ??
    publicMetrics.impression_count ??
    null;
  const impressionCount =
    typeof impressionCandidate === "number" && Number.isFinite(impressionCandidate)
      ? impressionCandidate
      : null;

  const engagementCount = likeCount + replyCount + retweetCount + quoteCount + bookmarkCount;
  const engagementRate =
    impressionCount && impressionCount > 0 ? Number((engagementCount / impressionCount).toFixed(6)) : null;

  return {
    platform: "x",
    fetchedAt: now,
    likeCount,
    replyCount,
    retweetCount,
    quoteCount,
    bookmarkCount,
    shareCount: 0,
    impressionCount,
    engagementCount,
    engagementRate,
  };
}

interface ThreadsInsightValueRow {
  value?: unknown;
  end_time?: unknown;
  link_url?: unknown;
}

interface ThreadsInsightRow {
  name?: unknown;
  values?: ThreadsInsightValueRow[];
  total_value?: { value?: unknown };
  link_total_values?: ThreadsInsightValueRow[];
}

function threadsEndpoint(path: string): string {
  return `https://graph.threads.net/v1.0/${path}`;
}

async function getThreadsJson(
  path: string,
  params: URLSearchParams
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${threadsEndpoint(path)}?${params.toString()}`, { method: "GET" });
  let json: Record<string, unknown> = {};
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

function numberFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function setStoreAnalyticsHealth(
  store: AnalyticsStore,
  platform: PublishPlatform,
  patch: Partial<AnalyticsPlatformHealth> & Pick<AnalyticsPlatformHealth, "status">
): void {
  const current = store.analyticsHealth?.[platform] ?? {};
  store.analyticsHealth = {
    ...(store.analyticsHealth ?? {}),
    [platform]: {
      ...current,
      ...patch,
    },
  };
}

function setTweetFetchState(
  tweet: TweetAnalyticsRecord,
  platform: PublishPlatform,
  patch: Partial<TweetAnalyticsFetchState> & Pick<TweetAnalyticsFetchState, "status">
): void {
  const current = tweet.analyticsFetchState?.[platform] ?? {};
  tweet.analyticsFetchState = {
    ...(tweet.analyticsFetchState ?? {}),
    [platform]: {
      ...current,
      ...patch,
    },
  };
}

function clearTweetFetchState(tweet: TweetAnalyticsRecord, platform: PublishPlatform): void {
  tweet.analyticsFetchState = {
    ...tweet.analyticsFetchState,
    [platform]: {
      status: "ok",
      updatedAt: nowIso(),
      failures: 0,
    },
  };
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return fallback;
}

function getXErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    if ("code" in err && typeof (err as { code?: number | string }).code !== "undefined") {
      return String((err as { code?: number | string }).code);
    }
    if (
      "data" in err &&
      (err as { data?: { title?: unknown } }).data &&
      typeof (err as { data?: { title?: unknown } }).data?.title === "string"
    ) {
      return String((err as { data?: { title?: unknown } }).data?.title);
    }
  }
  return undefined;
}

function isXCreditsDepletedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  const title =
    "data" in err && (err as { data?: { title?: unknown } }).data
      ? (err as { data?: { title?: unknown } }).data?.title
      : undefined;
  return code === 402 || title === "CreditsDepleted";
}

function isPermanentThreadsInsightsError(message: string, status: number): boolean {
  const normalized = message.toLowerCase();
  return (
    status === 400 ||
    status === 403 ||
    status === 404 ||
    normalized.includes("unsupported get request") ||
    normalized.includes("does not exist") ||
    normalized.includes("missing permissions")
  );
}

function nullableNumberFromUnknown(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getThreadsMetricValue(row: ThreadsInsightRow | undefined): number | null {
  if (!row) return null;
  const totalValue = nullableNumberFromUnknown(row.total_value?.value);
  if (totalValue !== null) return totalValue;

  const values = Array.isArray(row.values) ? row.values : [];
  if (values.length === 0) return null;
  const last = values[values.length - 1];
  return nullableNumberFromUnknown(last?.value);
}

function parseThreadsMediaMetrics(rows: ThreadsInsightRow[]): TweetMetricsSnapshot {
  const byName = new Map<string, ThreadsInsightRow>();
  for (const row of rows) {
    if (typeof row.name === "string") byName.set(row.name, row);
  }

  const fetchedAt = new Date().toISOString();
  const likeCount = getThreadsMetricValue(byName.get("likes")) ?? 0;
  const replyCount = getThreadsMetricValue(byName.get("replies")) ?? 0;
  const repostCount = getThreadsMetricValue(byName.get("reposts")) ?? 0;
  const quoteCount = getThreadsMetricValue(byName.get("quotes")) ?? 0;
  const shareCount = getThreadsMetricValue(byName.get("shares")) ?? 0;
  const impressionCount = getThreadsMetricValue(byName.get("views"));
  const engagementCount = likeCount + replyCount + repostCount + quoteCount + shareCount;
  const engagementRate =
    impressionCount && impressionCount > 0 ? Number((engagementCount / impressionCount).toFixed(6)) : null;

  return {
    platform: "threads",
    fetchedAt,
    likeCount,
    replyCount,
    retweetCount: repostCount,
    quoteCount,
    bookmarkCount: 0,
    shareCount,
    impressionCount,
    engagementCount,
    engagementRate,
  };
}

async function fetchThreadsMetricsByPostId(ids: string[]): Promise<{
  metricsById: Map<string, TweetMetricsSnapshot>;
  failuresById: Map<string, { message: string; status: number; permanent: boolean }>;
}> {
  const metricsById = new Map<string, TweetMetricsSnapshot>();
  const failuresById = new Map<string, { message: string; status: number; permanent: boolean }>();
  if (!THREADS_ACCESS_TOKEN || ids.length === 0) return { metricsById, failuresById };

  for (const id of ids) {
    const params = new URLSearchParams({
      metric: "views,likes,replies,reposts,quotes,shares",
      access_token: THREADS_ACCESS_TOKEN,
    });
    const response = await getThreadsJson(`${encodeURIComponent(id)}/insights`, params);
    if (!response.ok) {
      const message =
        typeof response.json.error === "object" && response.json.error && "message" in response.json.error
          ? String((response.json.error as { message?: unknown }).message ?? "")
          : `HTTP ${response.status}`;
      failuresById.set(id, {
        message,
        status: response.status,
        permanent: isPermanentThreadsInsightsError(message, response.status),
      });
      continue;
    }

    const rows = Array.isArray(response.json.data)
      ? (response.json.data.filter((row) => typeof row === "object" && row != null) as ThreadsInsightRow[])
      : [];
    metricsById.set(id, parseThreadsMediaMetrics(rows));
  }

  return { metricsById, failuresById };
}

function parseThreadsUserInsights(rows: ThreadsInsightRow[]): ThreadsUserInsightsSnapshot {
  const byName = new Map<string, ThreadsInsightRow>();
  for (const row of rows) {
    if (typeof row.name === "string") byName.set(row.name, row);
  }

  const clicksRow = byName.get("clicks");
  const clicksByUrl = Array.isArray(clicksRow?.link_total_values)
    ? clicksRow!.link_total_values!
        .map((row) => ({
          linkUrl: typeof row.link_url === "string" ? row.link_url : "",
          value: numberFromUnknown(row.value),
        }))
        .filter((row) => row.linkUrl.length > 0)
    : [];

  return {
    fetchedAt: new Date().toISOString(),
    views: getThreadsMetricValue(byName.get("views")),
    likes: getThreadsMetricValue(byName.get("likes")),
    replies: getThreadsMetricValue(byName.get("replies")),
    reposts: getThreadsMetricValue(byName.get("reposts")),
    quotes: getThreadsMetricValue(byName.get("quotes")),
    clicks: clicksByUrl.reduce((sum, row) => sum + row.value, 0),
    followersCount: getThreadsMetricValue(byName.get("followers_count")),
    clicksByUrl,
  };
}

async function fetchThreadsUserInsights(): Promise<ThreadsUserInsightsSnapshot | null> {
  if (!THREADS_ACCESS_TOKEN) return null;

  const params = new URLSearchParams({
    metric: "views,likes,replies,reposts,quotes,clicks,followers_count",
    access_token: THREADS_ACCESS_TOKEN,
  });
  const response = await getThreadsJson("me/threads_insights", params);
  if (!response.ok) {
    const message =
      typeof response.json.error === "object" && response.json.error && "message" in response.json.error
        ? String((response.json.error as { message?: unknown }).message ?? "")
        : `HTTP ${response.status}`;
    console.warn(`Threads user insights fetch failed: ${message}`);
    return null;
  }

  const rows = Array.isArray(response.json.data)
    ? (response.json.data.filter((row) => typeof row === "object" && row != null) as ThreadsInsightRow[])
    : [];
  return parseThreadsUserInsights(rows);
}

async function fetchTweetsBatch(
  client: TwitterApi,
  ids: string[],
  includeAdvancedFields: boolean
): Promise<Array<Record<string, unknown>>> {
  const fields = includeAdvancedFields
    ? "created_at,public_metrics,organic_metrics,non_public_metrics"
    : "created_at,public_metrics";

  const response = (await client.v2.get("tweets", {
    ids: ids.join(","),
    "tweet.fields": fields,
  })) as { data?: unknown };

  return Array.isArray(response.data)
    ? (response.data.filter((v) => typeof v === "object" && v != null) as Array<Record<string, unknown>>)
    : [];
}

async function fetchMetricsByTweetId(client: TwitterApi, ids: string[]): Promise<Map<string, TweetMetricsSnapshot>> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const out = new Map<string, TweetMetricsSnapshot>();

  for (const chunk of chunks) {
    let rows: Array<Record<string, unknown>> = [];
    try {
      rows = await fetchTweetsBatch(client, chunk, true);
    } catch {
      rows = await fetchTweetsBatch(client, chunk, false);
    }

    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) continue;
      out.set(id, parseTweetMetrics(row));
    }
  }

  return out;
}

function minutesSince(iso: string): number {
  return (Date.now() - Date.parse(iso)) / (60 * 1000);
}

export async function refreshMetricsForStore(
  store: AnalyticsStore,
  client: TwitterApi,
  options: RefreshOptions
): Promise<{ updated: number; attempted: number }> {
  const attemptAt = nowIso();
  setStoreAnalyticsHealth(store, "x", {
    status: store.analyticsHealth?.x?.status ?? "healthy",
    lastAttemptAt: attemptAt,
  });
  const oldestAllowed = Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000;

  const targets = store.tweets
    .filter((t) => t.status === "posted" && !!t.tweetId)
    .filter((t) => Date.parse(t.postedAt) >= oldestAllowed)
    .filter((t) => minutesSince(t.postedAt) >= options.minAgeMinutes)
    .filter((t) => !t.metrics || minutesSince(t.metrics.fetchedAt) >= 60)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, options.maxTweets);

  const ids = [...new Set(targets.map((t) => t.tweetId!).filter(Boolean))];
  if (ids.length === 0) return { updated: 0, attempted: 0 };

  let byId: Map<string, TweetMetricsSnapshot>;
  try {
    byId = await fetchMetricsByTweetId(client, ids);
  } catch (err) {
    const message = getErrorMessage(err, "X analytics refresh failed");
    if (isXCreditsDepletedError(err)) {
      console.warn(`X analytics blocked: ${message}`);
      setStoreAnalyticsHealth(store, "x", {
        status: "blocked",
        lastAttemptAt: attemptAt,
        lastError: message,
        lastErrorCode: getXErrorCode(err) ?? "CreditsDepleted",
      });
      return { updated: 0, attempted: ids.length };
    }

    console.warn(`X analytics refresh failed: ${message}`);
    setStoreAnalyticsHealth(store, "x", {
      status: "degraded",
      lastAttemptAt: attemptAt,
      lastError: message,
      lastErrorCode: getXErrorCode(err),
    });
    return { updated: 0, attempted: ids.length };
  }

  let updated = 0;
  for (const tweet of targets) {
    if (!tweet.tweetId) continue;
    const metrics = byId.get(tweet.tweetId);
    if (!metrics) {
      setTweetFetchState(tweet, "x", {
        status: "error",
        updatedAt: nowIso(),
        reason: "No X metrics returned for this tweet",
        failures: (tweet.analyticsFetchState?.x?.failures ?? 0) + 1,
      });
      continue;
    }
    tweet.metrics = metrics;
    tweet.score = computeScore(metrics);
    tweet.scoreUpdatedAt = nowIso();
    clearTweetFetchState(tweet, "x");
    updated++;
  }

  if (updated === 0 && ids.length > 0) {
    setStoreAnalyticsHealth(store, "x", {
      status: "degraded",
      lastAttemptAt: attemptAt,
      lastError: "No X metrics returned for eligible tweet(s)",
      lastErrorCode: "x_metrics_empty",
    });
  } else {
    setStoreAnalyticsHealth(store, "x", {
      status: "healthy",
      lastAttemptAt: attemptAt,
      lastSuccessAt: updated > 0 ? nowIso() : store.analyticsHealth?.x?.lastSuccessAt,
      lastError: updated > 0 ? undefined : store.analyticsHealth?.x?.lastError,
      lastErrorCode: updated > 0 ? undefined : store.analyticsHealth?.x?.lastErrorCode,
    });
  }

  return { updated, attempted: ids.length };
}

export async function refreshThreadsMetricsForStore(
  store: AnalyticsStore,
  options: RefreshOptions
): Promise<{ updated: number; attempted: number; userInsightsUpdated: boolean }> {
  const attemptAt = nowIso();
  setStoreAnalyticsHealth(store, "threads", {
    status: store.analyticsHealth?.threads?.status ?? "healthy",
    lastAttemptAt: attemptAt,
  });
  const oldestAllowed = Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000;

  const targets = store.tweets
    .filter((t) => t.status === "posted" && !!t.threadsPostId)
    .filter((t) => !t.analyticsFetchState?.threads?.permanent)
    .filter((t) => Date.parse(t.postedAt) >= oldestAllowed)
    .filter((t) => minutesSince(t.postedAt) >= options.minAgeMinutes)
    .filter((t) => !t.metrics || t.metrics.platform !== "threads" || minutesSince(t.metrics.fetchedAt) >= 60)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, options.maxTweets);

  const ids = [...new Set(targets.map((t) => t.threadsPostId!).filter(Boolean))];
  const { metricsById, failuresById } = await fetchThreadsMetricsByPostId(ids);

  let updated = 0;
  for (const tweet of targets) {
    if (!tweet.threadsPostId) continue;
    const metrics = metricsById.get(tweet.threadsPostId);
    if (!metrics) {
      const failure = failuresById.get(tweet.threadsPostId);
      if (failure) {
        setTweetFetchState(tweet, "threads", {
          status: failure.permanent ? "skipped" : "error",
          updatedAt: nowIso(),
          reason: failure.message,
          permanent: failure.permanent,
          failures: (tweet.analyticsFetchState?.threads?.failures ?? 0) + 1,
        });
      }
      continue;
    }
    tweet.metrics = metrics;
    tweet.score = computeScore(metrics);
    tweet.scoreUpdatedAt = nowIso();
    clearTweetFetchState(tweet, "threads");
    updated++;
  }

  const userInsights = await fetchThreadsUserInsights();
  if (userInsights) {
    store.threadsUserInsights = userInsights;
  }

  const failureMessages = [...failuresById.values()].map((failure) => failure.message);
  const hasPermanentFailures = [...failuresById.values()].some((failure) => failure.permanent);
  const status: AnalyticsPlatformStatus =
    updated > 0 || userInsights ? "healthy" : failureMessages.length > 0 ? "degraded" : "healthy";
  setStoreAnalyticsHealth(store, "threads", {
    status,
    lastAttemptAt: attemptAt,
    lastSuccessAt: updated > 0 || userInsights ? nowIso() : store.analyticsHealth?.threads?.lastSuccessAt,
    lastError: failureMessages.length > 0 ? failureMessages[0] : undefined,
    lastErrorCode: hasPermanentFailures ? "threads_media_insights_unavailable" : undefined,
  });

  return {
    updated,
    attempted: ids.length,
    userInsightsUpdated: Boolean(userInsights),
  };
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-z0-9_]+/gi) ?? [];
  return matches.map((h) => h.toLowerCase());
}

function startsWithNumber(text: string): boolean {
  return /^\s*\d/.test(text);
}

function hasAnyNumber(text: string): boolean {
  return /\d/.test(text);
}

function isQuestionLead(text: string): boolean {
  const firstSentence = text.split(/[.!?]/)[0] ?? "";
  return firstSentence.includes("?");
}

function countMatching(records: TweetAnalyticsRecord[], predicate: (r: TweetAnalyticsRecord) => boolean): number {
  let count = 0;
  for (const r of records) if (predicate(r)) count++;
  return count;
}

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

function avgLength(records: TweetAnalyticsRecord[]): number {
  if (records.length === 0) return 0;
  const total = records.reduce((acc, r) => acc + r.text.length, 0);
  return Math.round(total / records.length);
}

function avgMetric(records: TweetAnalyticsRecord[], selector: (record: TweetAnalyticsRecord) => number): number {
  if (records.length === 0) return 0;
  const total = records.reduce((acc, record) => acc + selector(record), 0);
  return Number((total / records.length).toFixed(2));
}

function avgScore(records: TweetAnalyticsRecord[]): number {
  return avgMetric(records, (record) => record.score ?? 0);
}

function collectTopHashtags(records: TweetAnalyticsRecord[], topN = 3): string[] {
  const map = new Map<string, number>();
  for (const record of records) {
    for (const hashtag of extractHashtags(record.text)) {
      map.set(hashtag, (map.get(hashtag) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([hashtag]) => hashtag);
}

function platformsForRecord(record: TweetAnalyticsRecord): PublishPlatform[] {
  if (record.publishTargets && record.publishTargets.length > 0) return [...new Set(record.publishTargets)];
  const platforms: PublishPlatform[] = [];
  if (record.tweetId || record.metrics?.platform === "x") platforms.push("x");
  if (record.threadsPostId || record.metrics?.platform === "threads") platforms.push("threads");
  return platforms.length > 0 ? platforms : ["x"];
}

function topByPlatform<
  T extends { count: number; avgScore: number; platform: PublishPlatform }
>(rows: T[]): T[] {
  const out: T[] = [];
  for (const platform of ["x", "threads"] as const) {
    const candidate = rows
      .filter((row) => row.platform === platform)
      .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)[0];
    if (candidate) out.push(candidate);
  }
  return out;
}

export function buildIterationInsights(store: AnalyticsStore): IterationInsights | null {
  const scored = store.tweets
    .filter((t) => typeof t.score === "number")
    .filter((t) => t.status === "posted")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 48);

  if (scored.length < 6) return null;

  const split = Math.max(2, Math.ceil(scored.length * 0.3));
  const winners = scored.slice(0, split);
  const losers = scored.slice(scored.length - split);

  const winnerPatterns: string[] = [];
  const avoidPatterns: string[] = [];

  const winnerNumberLead = pct(countMatching(winners, (r) => startsWithNumber(r.text)), winners.length);
  const loserNumberLead = pct(countMatching(losers, (r) => startsWithNumber(r.text)), losers.length);
  if (winnerNumberLead - loserNumberLead >= 20) {
    winnerPatterns.push(`Lead with a number-backed fact (${winnerNumberLead}% winners vs ${loserNumberLead}% losers).`);
  }

  const winnerAnyNumber = pct(countMatching(winners, (r) => hasAnyNumber(r.text)), winners.length);
  const loserAnyNumber = pct(countMatching(losers, (r) => hasAnyNumber(r.text)), losers.length);
  if (winnerAnyNumber - loserAnyNumber >= 20) {
    winnerPatterns.push(`Include a concrete stat in the hook (${winnerAnyNumber}% winners vs ${loserAnyNumber}% losers).`);
  }

  const winnerQuestion = pct(countMatching(winners, (r) => isQuestionLead(r.text)), winners.length);
  const loserQuestion = pct(countMatching(losers, (r) => isQuestionLead(r.text)), losers.length);
  if (loserQuestion - winnerQuestion >= 20) {
    avoidPatterns.push(`Avoid question-style opening hooks (${loserQuestion}% losers vs ${winnerQuestion}% winners).`);
  }

  const winnerAvgLength = avgLength(winners);
  const loserAvgLength = avgLength(losers);
  if (winnerAvgLength < loserAvgLength - 25) {
    winnerPatterns.push(`Keep copy tight (avg winner length ${winnerAvgLength} chars vs ${loserAvgLength}).`);
  } else if (loserAvgLength < winnerAvgLength - 25) {
    avoidPatterns.push(`Ultra-short posts underperformed (avg loser length ${loserAvgLength} chars).`);
  }

  const winnerHashtagAvg =
    winners.reduce((acc, r) => acc + extractHashtags(r.text).length, 0) / Math.max(winners.length, 1);
  const loserHashtagAvg =
    losers.reduce((acc, r) => acc + extractHashtags(r.text).length, 0) / Math.max(losers.length, 1);
  if (winnerHashtagAvg + 0.5 < loserHashtagAvg) {
    avoidPatterns.push("Use 1-2 hashtags; heavier hashtag usage has underperformed.");
  }

  const topWinnerHashtags = collectTopHashtags(winners, 3);
  if (topWinnerHashtags.length > 0) {
    winnerPatterns.push(`Lean on top-performing hashtags: ${topWinnerHashtags.join(", ")}.`);
  }

  const topAngles = [...new Map(winners.map((w) => [w.angle, 0])).keys()].slice(0, 2).filter(Boolean);
  if (topAngles.length > 0) {
    winnerPatterns.push(`Repeat winning theme(s): ${topAngles.join(" | ")}.`);
  }

  const promptGuidanceLines: string[] = [];
  const openerCounts = new Map<string, number>();
  for (const record of scored) {
    if (!record.openingPattern) continue;
    openerCounts.set(record.openingPattern, (openerCounts.get(record.openingPattern) ?? 0) + 1);
  }
  const avoidOpeners = [...openerCounts.entries()]
    .filter(([pattern, count]) => pattern === "most_teams" ? count > 1 : count >= 4)
    .sort((a, b) => b[1] - a[1])
    .map(([pattern]) => pattern);
  if (avoidOpeners.includes("most_teams")) {
    avoidPatterns.push("Do not use 'Most teams...' as an opener in the next batch.");
  }

  const contentModes: ContentMode[] = ["sports_only", "news_preferred"];
  const contentModeStats = contentModes
    .map((contentMode) => {
      const records = store.tweets.filter((tweet) => tweet.status === "posted" && tweet.contentMode === contentMode);
      return {
        contentMode,
        count: records.length,
        avgImpressions: avgMetric(records, (tweet) => tweet.metrics?.impressionCount ?? 0),
        avgClicks: avgMetric(records, (tweet) => tweet.clickMetrics?.totalClicks ?? 0),
      };
    })
    .filter((row) => row.count > 0);

  const newsSourceMap = new Map<string, TweetAnalyticsRecord[]>();
  for (const tweet of store.tweets) {
    if (tweet.status !== "posted" || !tweet.newsUsed || !tweet.newsSourceName) continue;
    const bucket = newsSourceMap.get(tweet.newsSourceName) ?? [];
    bucket.push(tweet);
    newsSourceMap.set(tweet.newsSourceName, bucket);
  }
  const newsSourceStats = [...newsSourceMap.entries()]
    .map(([sourceName, records]) => ({
      sourceName,
      count: records.length,
      avgImpressions: avgMetric(records, (tweet) => tweet.metrics?.impressionCount ?? 0),
      avgClicks: avgMetric(records, (tweet) => tweet.clickMetrics?.totalClicks ?? 0),
    }))
    .sort((a, b) => b.avgImpressions - a.avgImpressions);

  const frameRows: IterationInsights["topFramesByPlatform"] = [];
  const hookRows: IterationInsights["topHooksByPlatform"] = [];
  const pairRows: IterationInsights["topFrameHookPairs"] = [];
  const emotionRows: IterationInsights["topEmotionsByPlatform"] = [];

  for (const platform of ["x", "threads"] as const) {
    const records = scored.filter((tweet) => platformsForRecord(tweet).includes(platform));

    const frames = new Map<ContentFrameId, TweetAnalyticsRecord[]>();
    const hooks = new Map<HookStructureId, TweetAnalyticsRecord[]>();
    const pairs = new Map<string, TweetAnalyticsRecord[]>();
    const emotions = new Map<EmotionTarget, TweetAnalyticsRecord[]>();

    for (const record of records) {
      if (record.contentFrameId) {
        const bucket = frames.get(record.contentFrameId) ?? [];
        bucket.push(record);
        frames.set(record.contentFrameId, bucket);
      }
      if (record.hookStructureId) {
        const bucket = hooks.get(record.hookStructureId) ?? [];
        bucket.push(record);
        hooks.set(record.hookStructureId, bucket);
      }
      if (record.contentFrameId && record.hookStructureId) {
        const key = `${record.contentFrameId}::${record.hookStructureId}`;
        const bucket = pairs.get(key) ?? [];
        bucket.push(record);
        pairs.set(key, bucket);
      }
      if (record.emotionTarget) {
        const bucket = emotions.get(record.emotionTarget) ?? [];
        bucket.push(record);
        emotions.set(record.emotionTarget, bucket);
      }
    }

    for (const [frameId, recordsForFrame] of frames.entries()) {
      frameRows.push({
        platform,
        frameId,
        frameLabel: FRAME_DEFINITIONS[frameId]?.label ?? frameId,
        count: recordsForFrame.length,
        avgScore: avgScore(recordsForFrame),
      });
    }
    for (const [hookStructureId, recordsForHook] of hooks.entries()) {
      hookRows.push({
        platform,
        hookStructureId,
        hookStructureLabel: HOOK_DEFINITIONS[hookStructureId]?.label ?? hookStructureId,
        count: recordsForHook.length,
        avgScore: avgScore(recordsForHook),
      });
    }
    for (const [key, recordsForPair] of pairs.entries()) {
      const [frameId, hookStructureId] = key.split("::") as [ContentFrameId, HookStructureId];
      pairRows.push({
        platform,
        frameId,
        hookStructureId,
        count: recordsForPair.length,
        avgScore: avgScore(recordsForPair),
      });
    }
    for (const [emotionTarget, recordsForEmotion] of emotions.entries()) {
      emotionRows.push({
        platform,
        emotionTarget,
        count: recordsForEmotion.length,
        avgScore: avgScore(recordsForEmotion),
      });
    }
  }

  const topFramesByPlatform = topByPlatform(frameRows);
  const topHooksByPlatform = topByPlatform(hookRows);
  const topFrameHookPairs = topByPlatform(pairRows);
  const topEmotionsByPlatform = topByPlatform(emotionRows);
  const preferredEmotionByPlatform = topEmotionsByPlatform.map((row) => ({
    platform: row.platform,
    emotionTarget: row.emotionTarget,
  }));

  if (topFramesByPlatform.length > 0) {
    promptGuidanceLines.push(
      ...topFramesByPlatform.map((row) => `Platform ${row.platform.toUpperCase()} is responding best to the ${row.frameLabel} frame.`)
    );
  }
  if (topHooksByPlatform.length > 0) {
    promptGuidanceLines.push(
      ...topHooksByPlatform.map((row) => `Platform ${row.platform.toUpperCase()} is responding best to the ${row.hookStructureLabel} hook.`)
    );
  }
  if (preferredEmotionByPlatform.length > 0) {
    promptGuidanceLines.push(
      ...preferredEmotionByPlatform.map((row) => `Lean toward ${row.emotionTarget} on ${row.platform.toUpperCase()}.`)
    );
  }
  if (winnerPatterns.length > 0) promptGuidanceLines.push(...winnerPatterns.slice(0, 2));
  if (avoidPatterns.length > 0) promptGuidanceLines.push(...avoidPatterns.slice(0, 2));

  const promptGuidance = promptGuidanceLines.join(" ").slice(0, 900);

  return {
    sampleSize: scored.length,
    winners,
    losers,
    winnerPatterns,
    avoidPatterns,
    topWinnerHashtags,
    promptGuidance,
    contentModeStats,
    newsSourceStats,
    topFramesByPlatform,
    topHooksByPlatform,
    topFrameHookPairs,
    topEmotionsByPlatform,
    avoidOpeners,
    preferredEmotionByPlatform,
  };
}

export function formatInsightsReport(insights: IterationInsights): string {
  const lines: string[] = [];
  lines.push(`# Tweet iteration report (${new Date().toISOString()})`);
  lines.push(`Scored sample size: ${insights.sampleSize}`);
  lines.push("");

  lines.push("## Winner patterns");
  if (insights.winnerPatterns.length === 0) {
    lines.push("- No statistically useful winner patterns yet.");
  } else {
    for (const pattern of insights.winnerPatterns) lines.push(`- ${pattern}`);
  }

  lines.push("");
  lines.push("## Avoid patterns");
  if (insights.avoidPatterns.length === 0) {
    lines.push("- No clear avoid pattern yet.");
  } else {
    for (const pattern of insights.avoidPatterns) lines.push(`- ${pattern}`);
  }

  lines.push("");
  lines.push("## Top frames by platform");
  if (insights.topFramesByPlatform.length === 0) {
    lines.push("- No frame performance data yet.");
  } else {
    for (const row of insights.topFramesByPlatform) {
      lines.push(`- ${row.platform.toUpperCase()}: ${row.frameLabel} (${row.count} post(s), avg score ${row.avgScore})`);
    }
  }

  lines.push("");
  lines.push("## Top hooks by platform");
  if (insights.topHooksByPlatform.length === 0) {
    lines.push("- No hook performance data yet.");
  } else {
    for (const row of insights.topHooksByPlatform) {
      lines.push(`- ${row.platform.toUpperCase()}: ${row.hookStructureLabel} (${row.count} post(s), avg score ${row.avgScore})`);
    }
  }

  lines.push("");
  lines.push("## Preferred emotions by platform");
  if (insights.preferredEmotionByPlatform.length === 0) {
    lines.push("- No emotion performance data yet.");
  } else {
    for (const row of insights.preferredEmotionByPlatform) {
      lines.push(`- ${row.platform.toUpperCase()}: ${row.emotionTarget}`);
    }
  }

  lines.push("");
  lines.push("## Content mode performance");
  if (insights.contentModeStats.length === 0) {
    lines.push("- No content mode performance data yet.");
  } else {
    for (const row of insights.contentModeStats) {
      lines.push(
        `- ${row.contentMode}: ${row.count} post(s), avg impressions ${row.avgImpressions}, avg clicks ${row.avgClicks}`
      );
    }
  }

  lines.push("");
  lines.push("## News source performance");
  if (insights.newsSourceStats.length === 0) {
    lines.push("- No news-assisted tweets yet.");
  } else {
    for (const row of insights.newsSourceStats.slice(0, 5)) {
      lines.push(
        `- ${row.sourceName}: ${row.count} post(s), avg impressions ${row.avgImpressions}, avg clicks ${row.avgClicks}`
      );
    }
  }

  lines.push("");
  lines.push("## Avoid openers");
  if (insights.avoidOpeners.length === 0) {
    lines.push("- No overused opener detected.");
  } else {
    for (const opener of insights.avoidOpeners) lines.push(`- ${opener}`);
  }

  lines.push("");
  lines.push("## Top tweets");
  for (const tweet of insights.winners.slice(0, 3)) {
    const score = tweet.score?.toFixed(3) ?? "n/a";
    lines.push(`- (${score}) ${tweet.text}`);
  }

  lines.push("");
  lines.push("## Bottom tweets");
  for (const tweet of insights.losers.slice(0, 3)) {
    const score = tweet.score?.toFixed(3) ?? "n/a";
    lines.push(`- (${score}) ${tweet.text}`);
  }

  return lines.join("\n");
}

export function buildGenerationInsights(
  entries: Array<{
    failedChecks?: string[];
    rejectionReason?: string;
    contentFrameId?: ContentFrameId;
    hookStructureId?: HookStructureId;
    platformTargets?: PublishPlatform[];
    usedFallback?: boolean;
  }>
): GenerationInsightSummary {
  const failedChecks = new Map<string, number>();
  const reasons = new Map<string, number>();
  const frameHookFailures = new Map<string, number>();
  const threadsLengthFailures = new Map<HookStructureId, number>();
  const fallbackFrames = new Map<ContentFrameId, number>();

  for (const entry of entries) {
    for (const check of entry.failedChecks ?? []) {
      failedChecks.set(check, (failedChecks.get(check) ?? 0) + 1);
      if (entry.contentFrameId && entry.hookStructureId) {
        const key = `${entry.contentFrameId}::${entry.hookStructureId}`;
        frameHookFailures.set(key, (frameHookFailures.get(key) ?? 0) + 1);
      }
      if (check === "length" && entry.platformTargets?.includes("threads") && entry.hookStructureId) {
        threadsLengthFailures.set(entry.hookStructureId, (threadsLengthFailures.get(entry.hookStructureId) ?? 0) + 1);
      }
    }

    if (entry.rejectionReason) {
      reasons.set(entry.rejectionReason, (reasons.get(entry.rejectionReason) ?? 0) + 1);
    }
    if (entry.usedFallback && entry.contentFrameId) {
      fallbackFrames.set(entry.contentFrameId, (fallbackFrames.get(entry.contentFrameId) ?? 0) + 1);
    }
  }

  return {
    mostCommonFailedChecks: [...failedChecks.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([check, count]) => ({ check, count })),
    rewriteReasons: [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    frameHookFailures: [...frameHookFailures.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const [frameId, hookStructureId] = key.split("::") as [ContentFrameId, HookStructureId];
        return { frameId, hookStructureId, count };
      }),
    threadsLengthFailures: [...threadsLengthFailures.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hookStructureId, count]) => ({ hookStructureId, count })),
    fallbackFrames: [...fallbackFrames.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([frameId, count]) => ({ frameId, count })),
  };
}

/** Parse a "posts.log" style line and extract successful tweet text entries. */
export function parseSuccessfulLogTexts(logContent: string): Array<{ postedAt: string; text: string }> {
  const rows = logContent.split("\n").map((line) => line.trim()).filter(Boolean);
  const out: Array<{ postedAt: string; text: string }> = [];

  for (const row of rows) {
    const parts = row.split("\t");
    const postedAt = parts[0] ?? "";
    const status = parts[1] ?? "";
    const text = (parts[2] ?? "").trim();
    if (!postedAt || status !== "success" || !text) continue;
    if (text.startsWith("error=")) continue;
    out.push({ postedAt, text });
  }

  return out;
}
