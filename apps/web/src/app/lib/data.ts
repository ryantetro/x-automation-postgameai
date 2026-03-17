import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSmoothAreaPath, buildSmoothLinePath } from "./chartPaths";
import { getClickMetricsForTrackingIds, type ClickMetricsSnapshot } from "./clicks";
import { getTrafficMetricsForTrackingIds, type TrafficMetricsSnapshot } from "./posthog";

export interface CampaignConfig {
  slug: string;
  name: string;
  brandName: string;
  brandWebsite: string;
  dataSource: string;
}

export type TweetStatus = "posted" | "dry_run" | "failed";
export type PublishPlatform = "x" | "threads";
export type ContentFrameId =
  | "forty_eight_hour_window"
  | "film_room_truth"
  | "development_gap"
  | "moment_nobody_captures"
  | "scoreboard_lie"
  | "conversation_that_doesnt_happen";
export type HookStructureId =
  | "specific_number"
  | "contradiction"
  | "scene_setter"
  | "universal_truth"
  | "insider_divide"
  | "named_moment";
export type EmotionTarget =
  | "recognition"
  | "frustration"
  | "validation"
  | "insider_pride"
  | "loss"
  | "urgency"
  | "provocation"
  | "vulnerability";

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
  contentFrameId?: ContentFrameId;
  contentFrameLabel?: string;
  hookStructureId?: HookStructureId;
  hookStructureLabel?: string;
  emotionTarget?: EmotionTarget;
  frameReason?: string;
  openingPattern?: string;
  trackedUrl?: string;
  linkTargetUrl?: string;
  outboundTracking?: OutboundTrackingRecord[];
  metrics?: TweetMetricsSnapshot;
  clickMetrics?: ClickMetricsSnapshot;
  trafficMetrics?: TrafficMetricsSnapshot;
  score?: number;
  scoreUpdatedAt?: string;
  campaignSlug?: string;
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

export interface AnalyticsStore {
  version: number;
  updatedAt: string | null;
  clickMetricsAvailable: boolean;
  trafficMetricsAvailable: boolean;
  threadsUserInsights?: ThreadsUserInsightsSnapshot;
  tweets: TweetAnalyticsRecord[];
}

const WORKSPACE_ROOT = resolve(process.cwd(), "..", "..");
const BOT_STATE_FILES = [
  resolve(process.cwd(), "..", "social-bot-engine", "state", "tweet-analytics.json"),
  resolve(process.cwd(), "..", "social-bot-engine", "state", "threads-analytics.json"),
];
const REMOTE_X_STATE_URL =
  process.env.ANALYTICS_JSON_URL ??
  "https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/apps/social-bot-engine/state/tweet-analytics.json";
const REMOTE_THREADS_STATE_URL =
  process.env.THREADS_ANALYTICS_JSON_URL ??
  "https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/apps/social-bot-engine/state/threads-analytics.json";
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

function normalizeTrafficMetrics(metrics: Partial<TrafficMetricsSnapshot> | undefined): TrafficMetricsSnapshot | undefined {
  const fetchedAt = parseIso(metrics?.fetchedAt);
  if (!fetchedAt) return undefined;
  return {
    fetchedAt,
    landingVisits: nonNegativeNumber(metrics?.landingVisits),
    uniqueVisitors: nonNegativeNumber(metrics?.uniqueVisitors),
    sessions: nonNegativeNumber(metrics?.sessions),
    engagedSessions: nonNegativeNumber(metrics?.engagedSessions),
    signupsStarted: nonNegativeNumber(metrics?.signupsStarted),
    signupsCompleted: nonNegativeNumber(metrics?.signupsCompleted),
    demoBookings: nonNegativeNumber(metrics?.demoBookings),
    trialStarts: nonNegativeNumber(metrics?.trialStarts),
    purchases: nonNegativeNumber(metrics?.purchases),
  };
}

function inferTrackingPlatform(record: Partial<TweetAnalyticsRecord>): PublishPlatform {
  if (record.metrics?.platform === "threads") return "threads";
  if (record.metrics?.platform === "x") return "x";
  if (record.threadsPostId && !record.tweetId) return "threads";
  return "x";
}

function normalizeOutboundTracking(
  tracking: Partial<OutboundTrackingRecord> | undefined,
  fallback: {
    runId: string;
    trackingId: string;
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
  }
): OutboundTrackingRecord {
  return {
    trackingId: nonEmptyString(tracking?.trackingId) ?? fallback.trackingId,
    runId: nonEmptyString(tracking?.runId) ?? fallback.runId,
    platform: tracking?.platform === "threads" ? "threads" : tracking?.platform === "x" ? "x" : fallback.platform,
    campaignSlug: nonEmptyString(tracking?.campaignSlug) ?? fallback.campaignSlug,
    trackedUrl: nonEmptyString(tracking?.trackedUrl) ?? fallback.trackedUrl,
    linkTargetUrl: nonEmptyString(tracking?.linkTargetUrl) ?? fallback.linkTargetUrl,
    publishedPostId: nonEmptyString(tracking?.publishedPostId) ?? fallback.publishedPostId,
    utmSource: nonEmptyString(tracking?.utmSource) ?? fallback.utmSource,
    utmMedium: nonEmptyString(tracking?.utmMedium) ?? fallback.utmMedium,
    utmCampaign: nonEmptyString(tracking?.utmCampaign) ?? fallback.utmCampaign,
    utmContent: nonEmptyString(tracking?.utmContent) ?? fallback.utmContent,
    utmTerm: nonEmptyString(tracking?.utmTerm) ?? fallback.utmTerm,
    postSport: nonEmptyString(tracking?.postSport) ?? fallback.postSport,
    postSource: nonEmptyString(tracking?.postSource) ?? fallback.postSource,
    clickMetrics: normalizeClickMetrics(tracking?.clickMetrics),
    trafficMetrics: normalizeTrafficMetrics(tracking?.trafficMetrics),
  };
}

function aggregateClickMetrics(records: OutboundTrackingRecord[]): ClickMetricsSnapshot | undefined {
  const metrics = records.map((record) => record.clickMetrics).filter((value): value is ClickMetricsSnapshot => !!value);
  if (metrics.length === 0) return undefined;
  return {
    fetchedAt: latestIso(metrics.map((metric) => metric.fetchedAt)) ?? metrics[0].fetchedAt,
    totalClicks: metrics.reduce((sum, metric) => sum + metric.totalClicks, 0),
    uniqueClicks: metrics.reduce((sum, metric) => sum + metric.uniqueClicks, 0),
  };
}

function aggregateTrafficMetrics(records: OutboundTrackingRecord[]): TrafficMetricsSnapshot | undefined {
  const metrics = records.map((record) => record.trafficMetrics).filter((value): value is TrafficMetricsSnapshot => !!value);
  if (metrics.length === 0) return undefined;
  return {
    fetchedAt: latestIso(metrics.map((metric) => metric.fetchedAt)) ?? metrics[0].fetchedAt,
    landingVisits: metrics.reduce((sum, metric) => sum + metric.landingVisits, 0),
    uniqueVisitors: metrics.reduce((sum, metric) => sum + metric.uniqueVisitors, 0),
    sessions: metrics.reduce((sum, metric) => sum + metric.sessions, 0),
    engagedSessions: metrics.reduce((sum, metric) => sum + metric.engagedSessions, 0),
    signupsStarted: metrics.reduce((sum, metric) => sum + metric.signupsStarted, 0),
    signupsCompleted: metrics.reduce((sum, metric) => sum + metric.signupsCompleted, 0),
    demoBookings: metrics.reduce((sum, metric) => sum + metric.demoBookings, 0),
    trialStarts: metrics.reduce((sum, metric) => sum + metric.trialStarts, 0),
    purchases: metrics.reduce((sum, metric) => sum + metric.purchases, 0),
  };
}

function normalizeTweet(record: Partial<TweetAnalyticsRecord>): TweetAnalyticsRecord | null {
  const runId = nonEmptyString(record.runId);
  const postedAt = parseIso(record.postedAt);
  const status = record.status;
  if (!runId || !postedAt || (status !== "posted" && status !== "dry_run" && status !== "failed")) return null;

  const fallbackPlatform = inferTrackingPlatform(record);
  const fallbackTrackedUrl = nonEmptyString(record.trackedUrl);
  const fallbackLinkTargetUrl = nonEmptyString(record.linkTargetUrl);
  const outboundTracking = Array.isArray(record.outboundTracking)
    ? record.outboundTracking
        .filter((tracking) => !!tracking && typeof tracking === "object")
        .map((tracking) =>
          normalizeOutboundTracking(tracking as Partial<OutboundTrackingRecord>, {
            runId,
            trackingId: nonEmptyString(tracking.trackingId) ?? runId,
            platform: tracking.platform === "threads" ? "threads" : tracking.platform === "x" ? "x" : fallbackPlatform,
            campaignSlug: nonEmptyString(record.campaignSlug),
            trackedUrl: nonEmptyString(tracking.trackedUrl) ?? fallbackTrackedUrl ?? "",
            linkTargetUrl: nonEmptyString(tracking.linkTargetUrl) ?? fallbackLinkTargetUrl ?? "",
            publishedPostId:
              tracking.platform === "threads"
                ? nonEmptyString(record.threadsPostId)
                : nonEmptyString(record.tweetId),
            utmSource: tracking.platform === "threads" ? "threads" : "x",
            utmMedium: "social",
            utmCampaign: nonEmptyString(tracking.utmCampaign) ?? "postgame_ai_default_unknown_unknown",
            utmContent: nonEmptyString(tracking.utmContent) ?? (nonEmptyString(tracking.trackingId) ?? runId),
            utmTerm: nonEmptyString(tracking.utmTerm) ?? slugify(nonEmptyString(record.angle) ?? "general", 40),
            postSport: slugify(nonEmptyString(record.sport) ?? "sports", 20),
            postSource: slugify(nonEmptyString(record.source) ?? "automation", 20),
          })
        )
        .filter((tracking) => tracking.trackedUrl.length > 0 && tracking.linkTargetUrl.length > 0)
    : fallbackTrackedUrl && fallbackLinkTargetUrl
      ? [
          normalizeOutboundTracking(undefined, {
            runId,
            trackingId: runId,
            platform: fallbackPlatform,
            campaignSlug: nonEmptyString(record.campaignSlug),
            trackedUrl: fallbackTrackedUrl,
            linkTargetUrl: fallbackLinkTargetUrl,
            publishedPostId: fallbackPlatform === "threads" ? nonEmptyString(record.threadsPostId) : nonEmptyString(record.tweetId),
            utmSource: fallbackPlatform,
            utmMedium: "social",
            utmCampaign: `postgame_ai_${nonEmptyString(record.campaignSlug) ?? "default"}_${slugify(nonEmptyString(record.sport) ?? "sports", 20)}_${slugify(nonEmptyString(record.dateContext) ?? postedAt.slice(0, 10), 20)}`,
            utmContent: runId,
            utmTerm: slugify(nonEmptyString(record.angle) ?? "general", 40),
            postSport: slugify(nonEmptyString(record.sport) ?? "sports", 20),
            postSource: slugify(nonEmptyString(record.source) ?? "automation", 20),
          }),
        ]
      : [];

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
    contentFrameId:
      record.contentFrameId === "forty_eight_hour_window" ||
      record.contentFrameId === "film_room_truth" ||
      record.contentFrameId === "development_gap" ||
      record.contentFrameId === "moment_nobody_captures" ||
      record.contentFrameId === "scoreboard_lie" ||
      record.contentFrameId === "conversation_that_doesnt_happen"
        ? record.contentFrameId
        : undefined,
    contentFrameLabel: nonEmptyString(record.contentFrameLabel),
    hookStructureId:
      record.hookStructureId === "specific_number" ||
      record.hookStructureId === "contradiction" ||
      record.hookStructureId === "scene_setter" ||
      record.hookStructureId === "universal_truth" ||
      record.hookStructureId === "insider_divide" ||
      record.hookStructureId === "named_moment"
        ? record.hookStructureId
        : undefined,
    hookStructureLabel: nonEmptyString(record.hookStructureLabel),
    emotionTarget:
      record.emotionTarget === "recognition" ||
      record.emotionTarget === "frustration" ||
      record.emotionTarget === "validation" ||
      record.emotionTarget === "insider_pride" ||
      record.emotionTarget === "loss" ||
      record.emotionTarget === "urgency" ||
      record.emotionTarget === "provocation" ||
      record.emotionTarget === "vulnerability"
        ? record.emotionTarget
        : undefined,
    frameReason: nonEmptyString(record.frameReason),
    openingPattern: nonEmptyString(record.openingPattern),
    trackedUrl: outboundTracking[0]?.trackedUrl ?? fallbackTrackedUrl,
    linkTargetUrl: outboundTracking[0]?.linkTargetUrl ?? fallbackLinkTargetUrl,
    outboundTracking,
    metrics: normalizeMetrics(record.metrics),
    clickMetrics: normalizeClickMetrics(record.clickMetrics) ?? aggregateClickMetrics(outboundTracking),
    trafficMetrics: normalizeTrafficMetrics(record.trafficMetrics) ?? aggregateTrafficMetrics(outboundTracking),
    score: typeof record.score === "number" && Number.isFinite(record.score) ? record.score : undefined,
    scoreUpdatedAt: parseIso(record.scoreUpdatedAt) ?? undefined,
    campaignSlug: nonEmptyString(record.campaignSlug),
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
    trafficMetricsAvailable: false,
    threadsUserInsights,
    tweets,
  };
}

function mergeOutboundTracking(existing: OutboundTrackingRecord[] = [], incoming: OutboundTrackingRecord[] = []): OutboundTrackingRecord[] {
  const merged = new Map<string, OutboundTrackingRecord>();
  for (const record of [...existing, ...incoming]) {
    const current = merged.get(record.trackingId);
    merged.set(record.trackingId, current ? { ...current, ...record } : record);
  }
  return [...merged.values()].sort((a, b) => a.platform.localeCompare(b.platform));
}

function mergeTweetRecords(existing: TweetAnalyticsRecord, incoming: TweetAnalyticsRecord): TweetAnalyticsRecord {
  const mergedTracking = mergeOutboundTracking(existing.outboundTracking, incoming.outboundTracking);
  return {
    ...existing,
    ...incoming,
    trackedUrl: incoming.trackedUrl ?? existing.trackedUrl,
    linkTargetUrl: incoming.linkTargetUrl ?? existing.linkTargetUrl,
    outboundTracking: mergedTracking,
    clickMetrics: incoming.clickMetrics ?? existing.clickMetrics ?? aggregateClickMetrics(mergedTracking),
    trafficMetrics: incoming.trafficMetrics ?? existing.trafficMetrics ?? aggregateTrafficMetrics(mergedTracking),
    campaignSlug: incoming.campaignSlug ?? existing.campaignSlug,
  };
}

function dedupeTweets(tweets: TweetAnalyticsRecord[]): TweetAnalyticsRecord[] {
  const byKey = new Map<string, TweetAnalyticsRecord>();
  for (const tweet of tweets) {
    const key = tweet.tweetId ?? tweet.threadsPostId ?? tweet.runId;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeTweetRecords(existing, tweet) : tweet);
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
    trafficMetricsAvailable: false,
    threadsUserInsights,
    tweets,
  };
}

export function discoverCampaigns(): CampaignConfig[] {
  const campaignsDir = resolve(WORKSPACE_ROOT, "campaigns");
  if (!existsSync(campaignsDir)) return [];
  try {
    return readdirSync(campaignsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const configPath = resolve(campaignsDir, d.name, "config.json");
        if (!existsSync(configPath)) return null;
        try {
          const raw = JSON.parse(readFileSync(configPath, "utf-8"));
          return {
            slug: raw.slug ?? d.name,
            name: raw.name ?? d.name,
            brandName: raw.brandName ?? raw.name ?? d.name,
            brandWebsite: raw.brandWebsite ?? "",
            dataSource: raw.dataSource ?? "unknown",
          } as CampaignConfig;
        } catch {
          return null;
        }
      })
      .filter((c): c is CampaignConfig => c !== null);
  } catch {
    return [];
  }
}

async function loadCampaignStore(slug: string): Promise<AnalyticsStore> {
  const statePaths = [
    resolve(WORKSPACE_ROOT, "state", slug, "tweet-analytics.json"),
    resolve(WORKSPACE_ROOT, "state", slug, "threads-analytics.json"),
  ];
  // Postgame also checks legacy path
  if (slug === "postgame") {
    statePaths.push(...BOT_STATE_FILES);
  }

  const localStores: AnalyticsStore[] = [];
  for (const path of statePaths) {
    if (!existsSync(path)) continue;
    try {
      const p = JSON.parse(await readFile(path, "utf-8")) as Partial<AnalyticsStore>;
      if (Array.isArray(p.tweets)) localStores.push(normalizeStore(p));
    } catch {
      /* ignore */
    }
  }
  if (localStores.length > 0) {
    const store = mergeStores(localStores);
    for (const tweet of store.tweets) tweet.campaignSlug = slug;
    return store;
  }

  // Remote fallback for postgame only
  if (slug === "postgame") {
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
    if (remoteStores.length > 0) {
      const store = mergeStores(remoteStores);
      for (const tweet of store.tweets) tweet.campaignSlug = slug;
      return store;
    }
  }

  return { version: 1, updatedAt: null, clickMetricsAvailable: false, trafficMetricsAvailable: false, tweets: [] };
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

  return { version: 1, updatedAt: null, clickMetricsAvailable: false, trafficMetricsAvailable: false, tweets: [] };
}

export interface LoadStoreResult extends AnalyticsStore {
  campaigns: CampaignConfig[];
  activeCampaign: CampaignConfig | null;
}

export async function loadStore(options: { includeClicks?: boolean; campaignSlug?: string } = {}): Promise<LoadStoreResult> {
  const includeClicks = options.includeClicks ?? true;
  const campaigns = discoverCampaigns();

  let store: AnalyticsStore;
  let activeCampaign: CampaignConfig | null = null;

  if (options.campaignSlug && options.campaignSlug !== "all") {
    activeCampaign = campaigns.find((c) => c.slug === options.campaignSlug) ?? null;
    store = await loadCampaignStore(options.campaignSlug);
  } else {
    // Load all campaigns and merge
    if (campaigns.length > 0) {
      const allStores = await Promise.all(campaigns.map((c) => loadCampaignStore(c.slug)));
      store = mergeStores(allStores);
    } else {
      store = await loadBaseStore();
    }
  }

  if (includeClicks) {
    const trackingIds = [...new Set(
      store.tweets.flatMap((tweet) => tweet.outboundTracking?.map((tracking) => tracking.trackingId) ?? [])
    )];
    const [clickLookup, trafficLookup] = await Promise.all([
      getClickMetricsForTrackingIds(trackingIds),
      getTrafficMetricsForTrackingIds(trackingIds),
    ]);
    for (const tweet of store.tweets) {
      const outboundTracking = (tweet.outboundTracking ?? []).map((tracking) => ({
        ...tracking,
        clickMetrics: normalizeClickMetrics(clickLookup.metrics.get(tracking.trackingId)),
        trafficMetrics: normalizeTrafficMetrics(trafficLookup.metrics.get(tracking.trackingId)),
      }));
      tweet.outboundTracking = outboundTracking;
      tweet.trackedUrl = outboundTracking[0]?.trackedUrl ?? tweet.trackedUrl;
      tweet.linkTargetUrl = outboundTracking[0]?.linkTargetUrl ?? tweet.linkTargetUrl;
      tweet.clickMetrics = aggregateClickMetrics(outboundTracking) ?? normalizeClickMetrics(tweet.clickMetrics);
      tweet.trafficMetrics = aggregateTrafficMetrics(outboundTracking) ?? normalizeTrafficMetrics(tweet.trafficMetrics);
    }
    store.clickMetricsAvailable = clickLookup.available;
    store.trafficMetricsAvailable = trafficLookup.available;
    store.updatedAt = latestIso([
      store.updatedAt,
      ...store.tweets.map((tweet) => tweet.metrics?.fetchedAt),
      ...store.tweets.map((tweet) => tweet.clickMetrics?.fetchedAt),
      ...store.tweets.map((tweet) => tweet.trafficMetrics?.fetchedAt),
      store.threadsUserInsights?.fetchedAt,
    ]);
  }

  return { ...store, campaigns, activeCampaign };
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

function slugify(value: string, maxLength = 48): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
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
  const line = buildSmoothLinePath(pts);
  return { line, area: buildSmoothAreaPath(pts, h) };
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

const FRAME_LABELS: Record<ContentFrameId, string> = {
  forty_eight_hour_window: "48-Hour Window",
  film_room_truth: "Film Room Truth",
  development_gap: "Development Gap",
  moment_nobody_captures: "Moment Nobody Captures",
  scoreboard_lie: "Scoreboard Lie",
  conversation_that_doesnt_happen: "Conversation Gap",
};

const HOOK_LABELS: Record<HookStructureId, string> = {
  specific_number: "Specific Number",
  contradiction: "Contradiction",
  scene_setter: "Scene-Setter",
  universal_truth: "Universal Truth",
  insider_divide: "Insider Divide",
  named_moment: "Named Moment",
};

export function frameLabel(record: Pick<TweetAnalyticsRecord, "contentFrameId" | "contentFrameLabel">): string {
  if (record.contentFrameLabel) return record.contentFrameLabel;
  if (record.contentFrameId) return FRAME_LABELS[record.contentFrameId];
  return "Unclassified";
}

export function hookLabel(record: Pick<TweetAnalyticsRecord, "hookStructureId" | "hookStructureLabel">): string {
  if (record.hookStructureLabel) return record.hookStructureLabel;
  if (record.hookStructureId) return HOOK_LABELS[record.hookStructureId];
  return "Unknown Hook";
}

export function frameClass(frameId?: ContentFrameId): string {
  return frameId ?? "unclassified";
}
