import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getClickMetricsForSlugs, type ClickMetricsSnapshot } from "./clicks";

export type TweetStatus = "posted" | "dry_run" | "failed";
export type PublishPlatform = "x" | "threads";

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
  trackedUrl?: string;
  linkTargetUrl?: string;
  metrics?: TweetMetricsSnapshot;
  clickMetrics?: ClickMetricsSnapshot;
  score?: number;
  scoreUpdatedAt?: string;
}

export interface AnalyticsStore {
  version: number;
  updatedAt: string | null;
  clickMetricsAvailable: boolean;
  threadsUserInsights?: ThreadsUserInsightsSnapshot;
  tweets: TweetAnalyticsRecord[];
}

const BOT_STATE_FILES = [
  resolve(process.cwd(), "..", "postgame-x-bot", "state", "tweet-analytics.json"),
  resolve(process.cwd(), "..", "postgame-x-bot", "state", "threads-analytics.json"),
];
const REMOTE_X_STATE_URL =
  process.env.ANALYTICS_JSON_URL ??
  "https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/apps/postgame-x-bot/state/tweet-analytics.json";
const REMOTE_THREADS_STATE_URL =
  process.env.THREADS_ANALYTICS_JSON_URL ??
  "https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/apps/postgame-x-bot/state/threads-analytics.json";
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function parseIso(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  if (parsed > Date.now() + MAX_FUTURE_SKEW_MS) return null;
  return new Date(parsed).toISOString();
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function nonNegativeNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function latestIso(values: Array<string | null | undefined>): string | null {
  const valid = values.filter((value): value is string => typeof value === "string" && value.length > 0);
  if (valid.length === 0) return null;
  return valid.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

function normalizeMetrics(metrics: Partial<TweetMetricsSnapshot> | undefined): TweetMetricsSnapshot | undefined {
  const fetchedAt = parseIso(metrics?.fetchedAt);
  if (!fetchedAt) return undefined;

  const likeCount = nonNegativeNumber(metrics?.likeCount);
  const replyCount = nonNegativeNumber(metrics?.replyCount);
  const retweetCount = nonNegativeNumber(metrics?.retweetCount);
  const quoteCount = nonNegativeNumber(metrics?.quoteCount);
  const bookmarkCount = nonNegativeNumber(metrics?.bookmarkCount);
  const shareCount = nonNegativeNumber(metrics?.shareCount);
  const impressionCount = nonNegativeNullableNumber(metrics?.impressionCount);
  const engagementCount = likeCount + replyCount + retweetCount + quoteCount + bookmarkCount + shareCount;
  const engagementRate = impressionCount && impressionCount > 0 ? engagementCount / impressionCount : null;

  return {
    platform: metrics?.platform === "threads" ? "threads" : metrics?.platform === "x" ? "x" : undefined,
    fetchedAt,
    likeCount,
    replyCount,
    retweetCount,
    quoteCount,
    bookmarkCount,
    shareCount,
    impressionCount,
    engagementCount,
    engagementRate,
  };
}

function normalizeClickMetrics(metrics: Partial<ClickMetricsSnapshot> | undefined): ClickMetricsSnapshot | undefined {
  const fetchedAt = parseIso(metrics?.fetchedAt);
  if (!fetchedAt) return undefined;
  return {
    fetchedAt,
    totalClicks: nonNegativeNumber(metrics?.totalClicks),
    uniqueClicks: nonNegativeNumber(metrics?.uniqueClicks),
  };
}

function normalizeTweet(record: Partial<TweetAnalyticsRecord>): TweetAnalyticsRecord | null {
  const runId = nonEmptyString(record.runId);
  const postedAt = parseIso(record.postedAt);
  const status = record.status;
  if (!runId || !postedAt || (status !== "posted" && status !== "dry_run" && status !== "failed")) return null;

  return {
    runId,
    tweetId: nonEmptyString(record.tweetId),
    threadsPostId: nonEmptyString(record.threadsPostId),
    postedAt,
    dateContext: nonEmptyString(record.dateContext) ?? postedAt.slice(0, 10),
    sport: nonEmptyString(record.sport) ?? "unknown",
    angle: nonEmptyString(record.angle) ?? "unknown",
    source: nonEmptyString(record.source) ?? "unknown",
    status,
    text: nonEmptyString(record.text) ?? "",
    trackedUrl: nonEmptyString(record.trackedUrl),
    linkTargetUrl: nonEmptyString(record.linkTargetUrl),
    metrics: normalizeMetrics(record.metrics),
    clickMetrics: normalizeClickMetrics(record.clickMetrics),
    score: typeof record.score === "number" && Number.isFinite(record.score) ? record.score : undefined,
    scoreUpdatedAt: parseIso(record.scoreUpdatedAt) ?? undefined,
  };
}

function normalizeStore(payload: Partial<AnalyticsStore>): AnalyticsStore {
  const tweets = Array.isArray(payload.tweets) ? payload.tweets.map(normalizeTweet).filter((tweet): tweet is TweetAnalyticsRecord => tweet !== null) : [];
  const threadsUserInsights =
    payload.threadsUserInsights && typeof payload.threadsUserInsights === "object"
      ? {
          fetchedAt: parseIso((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).fetchedAt) ?? new Date().toISOString(),
          views: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).views),
          likes: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).likes),
          replies: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).replies),
          reposts: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).reposts),
          quotes: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).quotes),
          clicks: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).clicks),
          followersCount: nonNegativeNullableNumber((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).followersCount),
          clicksByUrl: Array.isArray((payload.threadsUserInsights as ThreadsUserInsightsSnapshot).clicksByUrl)
            ? (payload.threadsUserInsights as ThreadsUserInsightsSnapshot).clicksByUrl
                .map((row) => ({
                  linkUrl: nonEmptyString(row.linkUrl) ?? "",
                  value: nonNegativeNumber(row.value),
                }))
                .filter((row) => row.linkUrl.length > 0)
            : [],
        }
      : undefined;
  const updatedAt = latestIso([
    parseIso(payload.updatedAt),
    ...tweets.map((tweet) => tweet.metrics?.fetchedAt),
    threadsUserInsights?.fetchedAt,
  ]);

  return {
    version: typeof payload.version === "number" ? payload.version : 1,
    updatedAt,
    clickMetricsAvailable: false,
    threadsUserInsights,
    tweets,
  };
}

function dedupeTweets(tweets: TweetAnalyticsRecord[]): TweetAnalyticsRecord[] {
  const byKey = new Map<string, TweetAnalyticsRecord>();
  for (const tweet of tweets) {
    const key = tweet.tweetId ?? tweet.threadsPostId ?? tweet.runId;
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, ...tweet } : tweet);
  }
  return [...byKey.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

function mergeStores(stores: AnalyticsStore[]): AnalyticsStore {
  const tweets = dedupeTweets(stores.flatMap((store) => store.tweets));
  const updatedAt = latestIso(stores.map((store) => store.updatedAt).filter(Boolean));
  const threadsUserInsights = stores
    .map((store) => store.threadsUserInsights)
    .filter((value): value is ThreadsUserInsightsSnapshot => Boolean(value))
    .sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0];

  return {
    version: Math.max(1, ...stores.map((store) => store.version)),
    updatedAt,
    clickMetricsAvailable: false,
    threadsUserInsights,
    tweets,
  };
}

async function loadBaseStore(): Promise<AnalyticsStore> {
  const localStores: AnalyticsStore[] = [];
  for (const path of BOT_STATE_FILES) {
    if (!existsSync(path)) continue;
    try {
      const p = JSON.parse(await readFile(path, "utf-8")) as Partial<AnalyticsStore>;
      if (Array.isArray(p.tweets)) localStores.push(normalizeStore(p));
    } catch {
      /* ignore */
    }
  }
  if (localStores.length > 0) return mergeStores(localStores);

  const remoteStores: AnalyticsStore[] = [];
  for (const url of [REMOTE_X_STATE_URL, REMOTE_THREADS_STATE_URL]) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const p = (await r.json()) as Partial<AnalyticsStore>;
      if (Array.isArray(p.tweets)) remoteStores.push(normalizeStore(p));
    } catch {
      /* fallback */
    }
  }
  if (remoteStores.length > 0) return mergeStores(remoteStores);

  return { version: 1, updatedAt: null, clickMetricsAvailable: false, tweets: [] };
}

export async function loadStore(options: { includeClicks?: boolean } = {}): Promise<AnalyticsStore> {
  const includeClicks = options.includeClicks ?? true;
  const store = await loadBaseStore();
  if (!includeClicks) return store;

  const clickable = store.tweets.filter((tweet) => !!tweet.trackedUrl);
  const clickLookup = await getClickMetricsForSlugs(clickable.map((tweet) => tweet.runId));
  for (const tweet of store.tweets) {
    const metrics = clickLookup.metrics.get(tweet.runId);
    if (metrics) tweet.clickMetrics = normalizeClickMetrics(metrics);
    else delete tweet.clickMetrics;
  }
  store.clickMetricsAvailable = clickLookup.available;
  store.updatedAt = latestIso([
    store.updatedAt,
    ...store.tweets.map((tweet) => tweet.metrics?.fetchedAt),
    ...store.tweets.map((tweet) => tweet.clickMetrics?.fetchedAt),
    store.threadsUserInsights?.fetchedAt,
  ]);
  return store;
}

export function safeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function shortDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { day: "2-digit", month: "short" }).toLowerCase();
}

export function chartAxisLabels(records: Array<{ postedAt: string }>, maxLabels = 6): string[] {
  if (records.length === 0) return ["—"];

  const sampled = records
    .filter((_, index) => index % Math.max(1, Math.floor(records.length / maxLabels)) === 0)
    .slice(0, maxLabels);

  const dayCounts = new Map<string, number>();
  for (const record of sampled) {
    const key = record.postedAt.slice(0, 10);
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }

  return sampled.map((record) => {
    const d = new Date(record.postedAt);
    if (Number.isNaN(d.getTime())) return "--";
    const includeTime = (dayCounts.get(record.postedAt.slice(0, 10)) ?? 0) > 1;
    return d.toLocaleString("en-US", includeTime ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric" });
  });
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function linePath(values: number[], w: number, h: number): { line: string; area: string } {
  if (!values.length) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pts = values.map((v, i) => ({
    x: (i / Math.max(values.length - 1, 1)) * w,
    y: h - ((v - min) / span) * h,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w},${h} L0,${h}Z` };
}

export function sportClass(sport: string): string {
  const s = sport.toLowerCase();
  if (s === "nfl") return "nfl";
  if (s === "nba") return "nba";
  if (s === "mlb") return "mlb";
  if (s === "soccer") return "soccer";
  return "default";
}

export function lastUpdatedStr(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function platformClass(record: Pick<TweetAnalyticsRecord, "tweetId" | "threadsPostId">): "x" | "threads" | "dual" {
  if (record.tweetId && record.threadsPostId) return "dual";
  if (record.threadsPostId) return "threads";
  return "x";
}

export function platformLabel(record: Pick<TweetAnalyticsRecord, "tweetId" | "threadsPostId">): string {
  const platform = platformClass(record);
  if (platform === "dual") return "X + Threads";
  if (platform === "threads") return "Threads";
  return "X";
}
