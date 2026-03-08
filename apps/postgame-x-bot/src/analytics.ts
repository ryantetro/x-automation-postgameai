import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TwitterApi } from "twitter-api-v2";
import { ANALYTICS_STORE_FILENAME, STATE_DIR, THREADS_ACCESS_TOKEN } from "./config.js";

export const ANALYTICS_STORE_FILE = resolve(STATE_DIR, ANALYTICS_STORE_FILENAME);
const STORE_VERSION = 2;

export type TweetStatus = "posted" | "dry_run" | "failed";
export type ContentMode = "sports_only" | "news_preferred";
export type PublishPlatform = "x" | "threads";

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
  trackedUrl?: string;
  linkTargetUrl?: string;
  publishTargets?: PublishPlatform[];
  publishResults?: PlatformPublishResult[];
  metrics?: TweetMetricsSnapshot;
  clickMetrics?: ClickMetricsSnapshot;
  score?: number;
  scoreUpdatedAt?: string;
}

export interface AnalyticsStore {
  version: number;
  updatedAt: string;
  tweets: TweetAnalyticsRecord[];
  threadsUserInsights?: ThreadsUserInsightsSnapshot;
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
}

export function defaultStore(): AnalyticsStore {
  return {
    version: STORE_VERSION,
    updatedAt: new Date().toISOString(),
    tweets: [],
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
  const weighted =
    metrics.likeCount * 1.0 +
    metrics.retweetCount * 2.2 +
    metrics.replyCount * 2.4 +
    metrics.quoteCount * 2.1 +
    metrics.bookmarkCount * 1.3 +
    (metrics.shareCount ?? 0) * 1.6;
  if (metrics.impressionCount && metrics.impressionCount > 0) {
    const rate = weighted / metrics.impressionCount;
    return Number((rate * 100 + Math.log10(1 + weighted)).toFixed(4));
  }
  return Number((Math.log10(1 + weighted) * 10).toFixed(4));
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

async function fetchThreadsMetricsByPostId(ids: string[]): Promise<Map<string, TweetMetricsSnapshot>> {
  const out = new Map<string, TweetMetricsSnapshot>();
  if (!THREADS_ACCESS_TOKEN || ids.length === 0) return out;

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
      console.warn(`Threads media insights fetch failed for ${id}: ${message}`);
      continue;
    }

    const rows = Array.isArray(response.json.data)
      ? (response.json.data.filter((row) => typeof row === "object" && row != null) as ThreadsInsightRow[])
      : [];
    out.set(id, parseThreadsMediaMetrics(rows));
  }

  return out;
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

  const byId = await fetchMetricsByTweetId(client, ids);

  let updated = 0;
  for (const tweet of targets) {
    if (!tweet.tweetId) continue;
    const metrics = byId.get(tweet.tweetId);
    if (!metrics) continue;
    tweet.metrics = metrics;
    tweet.score = computeScore(metrics);
    tweet.scoreUpdatedAt = new Date().toISOString();
    updated++;
  }

  return { updated, attempted: ids.length };
}

export async function refreshThreadsMetricsForStore(
  store: AnalyticsStore,
  options: RefreshOptions
): Promise<{ updated: number; attempted: number; userInsightsUpdated: boolean }> {
  const oldestAllowed = Date.now() - options.lookbackDays * 24 * 60 * 60 * 1000;

  const targets = store.tweets
    .filter((t) => t.status === "posted" && !!t.threadsPostId)
    .filter((t) => Date.parse(t.postedAt) >= oldestAllowed)
    .filter((t) => minutesSince(t.postedAt) >= options.minAgeMinutes)
    .filter((t) => !t.metrics || t.metrics.platform !== "threads" || minutesSince(t.metrics.fetchedAt) >= 60)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, options.maxTweets);

  const ids = [...new Set(targets.map((t) => t.threadsPostId!).filter(Boolean))];
  const byId = await fetchThreadsMetricsByPostId(ids);

  let updated = 0;
  for (const tweet of targets) {
    if (!tweet.threadsPostId) continue;
    const metrics = byId.get(tweet.threadsPostId);
    if (!metrics) continue;
    tweet.metrics = metrics;
    tweet.score = computeScore(metrics);
    tweet.scoreUpdatedAt = new Date().toISOString();
    updated++;
  }

  const userInsights = await fetchThreadsUserInsights();
  if (userInsights) {
    store.threadsUserInsights = userInsights;
  }

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
  if (winnerPatterns.length > 0) promptGuidanceLines.push(...winnerPatterns.slice(0, 3));
  if (avoidPatterns.length > 0) promptGuidanceLines.push(...avoidPatterns.slice(0, 2));

  const promptGuidance = promptGuidanceLines.join(" ").slice(0, 900);

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
