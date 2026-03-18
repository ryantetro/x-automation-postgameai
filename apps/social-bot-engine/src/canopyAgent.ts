import type {
  AnalyticsStore,
  CanopyAgentMode,
  CanopyBrandTagPolicy,
  CanopyBuyerIntentLevel,
  CanopyContentBucket,
  CanopyCtaMode,
  CanopyImageShotType,
  CanopyImageStyleFamily,
  CanopySeriesId,
  CanopyUrgencyMode,
  CanopyVoiceFamily,
  TweetAnalyticsRecord,
} from "./analytics.js";
import { buildCampaignImagePromptForAngle, type CampaignImagePromptDetails } from "./generateImage.js";
import { loadContentPillars, loadPillarForAngle, type ContentPillar } from "./contentPillars.js";

const WINDOW_DAYS = 45;
const RECENT_COUNT = 30;
const MIN_PROMOTION_SAMPLE = 2;
const EXPLORE_RATE = 0.2;
const MAX_DIMENSION_SHARE = 0.55;
const AGENT_VERSION = "canopy_agent_v2";
const BRAND_TAG_TARGET_SHARE = 0.35;
const SERIES_COOLDOWN_POSTS = 2;
const CONTENT_BUCKET_TARGETS: Record<CanopyContentBucket, number> = {
  culture: 0.6,
  education: 0.2,
  community: 0.1,
  promo: 0.1,
};
const SERIES_TARGETS: Record<CanopySeriesId, number> = {
  vendor_life: 0.3,
  booth_hot_take: 0.22,
  booth_identity: 0.2,
  proof_in_the_wild: 0.18,
  utah_event_radar: 0.1,
};

export interface CanopyDimensionStat {
  dimension: string;
  value: string;
  sampleSize: number;
  weightedScore: number;
  avgScore: number;
  recentShare: number;
}

export interface CanopyWinnerCluster {
  strategyEnvelopeId: string;
  sampleSize: number;
  avgScore: number;
  fields: {
    pillarId: string;
    seriesId: string;
    contentBucket: string;
    voiceFamily: string;
    creativeDirection: string;
    buyerIntentLevel: string;
    productFocus: string;
    useCaseVertical: string;
    urgencyMode: string;
    ctaMode: string;
    imageStyleFamily?: string;
    imageShotType?: string;
  };
}

export interface CanopyAgentMemory {
  optimizerVersion: string;
  performanceWindowLabel: string;
  totalPostsConsidered: number;
  averageHybridScore: number;
  dimensions: Record<string, CanopyDimensionStat[]>;
  winnerClusters: CanopyWinnerCluster[];
  loserClusters: CanopyWinnerCluster[];
  overusedWarnings: string[];
  explorationTargets: string[];
  lastLessonSummary: string;
}

export interface CanopyStrategyEnvelope {
  id: string;
  pillarId: string;
  seriesId: CanopySeriesId;
  contentBucket: CanopyContentBucket;
  brandTagPolicy: CanopyBrandTagPolicy;
  angle: string;
  voiceFamily: CanopyVoiceFamily;
  creativeDirection: string;
  buyerIntentLevel: CanopyBuyerIntentLevel;
  productFocus: string;
  useCaseVertical: string;
  urgencyMode: CanopyUrgencyMode;
  ctaMode: CanopyCtaMode;
  targetAudience: string;
  postIdeas: string[];
  contextHint: string;
  optimizerVersion: string;
  agentMode: CanopyAgentMode;
  performanceWindowLabel: string;
  agentReasoningSummary: string;
  selectionReason: string;
}

export interface CanopyCandidate {
  candidateId: string;
  candidateBatchId: string;
  text: string;
  candidateScore: number;
  candidateRank: number;
  candidateRejectionReason?: string;
  selectedForPublish: boolean;
}

function nowDate(date?: Date): Date {
  return date ? new Date(date) : new Date();
}

function canopyRecords(store: AnalyticsStore, date: Date): TweetAnalyticsRecord[] {
  const cutoff = date.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return store.tweets
    .filter((tweet) => tweet.status === "posted")
    .filter((tweet) => tweet.sport === "canopy")
    .filter((tweet) => !!tweet.tweetId)
    .filter((tweet) => !!tweet.metrics && typeof tweet.metrics.impressionCount === "number")
    .filter((tweet) => Date.parse(tweet.postedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
}

function recencyWeight(record: TweetAnalyticsRecord, date: Date): number {
  const ageDays = Math.max(0, (date.getTime() - Date.parse(record.postedAt)) / (24 * 60 * 60 * 1000));
  return 1 / (1 + ageDays * 0.08);
}

function hybridScore(record: TweetAnalyticsRecord): number {
  const metrics = record.metrics;
  const impressions = metrics?.impressionCount ?? 0;
  const likes = metrics?.likeCount ?? 0;
  const replies = metrics?.replyCount ?? 0;
  const reposts = metrics?.retweetCount ?? 0;
  const quotes = metrics?.quoteCount ?? 0;
  const bookmarks = metrics?.bookmarkCount ?? 0;
  return Number((impressions + likes * 8 + replies * 16 + reposts * 14 + quotes * 12 + bookmarks * 10).toFixed(4));
}

function averageHybrid(records: TweetAnalyticsRecord[], date: Date): number {
  if (records.length === 0) return 0;
  let sum = 0;
  let weights = 0;
  for (const record of records) {
    const weight = recencyWeight(record, date);
    sum += hybridScore(record) * weight;
    weights += weight;
  }
  return weights > 0 ? sum / weights : 0;
}

function recentShare(records: TweetAnalyticsRecord[], getValue: (record: TweetAnalyticsRecord) => string | undefined, value: string): number {
  if (records.length === 0) return 0;
  const hits = records.filter((record) => getValue(record) === value).length;
  return hits / records.length;
}

function aggregateDimension(
  records: TweetAnalyticsRecord[],
  recentRecords: TweetAnalyticsRecord[],
  date: Date,
  dimension: string,
  getValue: (record: TweetAnalyticsRecord) => string | undefined
): CanopyDimensionStat[] {
  const buckets = new Map<string, TweetAnalyticsRecord[]>();
  for (const record of records) {
    const value = getValue(record);
    if (!value) continue;
    const bucket = buckets.get(value) ?? [];
    bucket.push(record);
    buckets.set(value, bucket);
  }
  return [...buckets.entries()]
    .map(([value, bucket]) => ({
      dimension,
      value,
      sampleSize: bucket.length,
      weightedScore: averageHybrid(bucket, date),
      avgScore: bucket.reduce((sum, record) => sum + hybridScore(record), 0) / Math.max(bucket.length, 1),
      recentShare: recentShare(recentRecords, getValue, value),
    }))
    .sort((a, b) => b.weightedScore - a.weightedScore || b.sampleSize - a.sampleSize);
}

function strategyEnvelopeId(record: Pick<TweetAnalyticsRecord, "campaignStrategyId" | "seriesId" | "contentBucket" | "voiceFamily" | "creativeDirection" | "buyerIntentLevel" | "productFocus" | "useCaseVertical" | "urgencyMode" | "ctaMode" | "imageStyleFamily" | "imageShotType">): string {
  return [
    record.campaignStrategyId ?? "unknown",
    record.seriesId ?? "unknown",
    record.contentBucket ?? "unknown",
    record.voiceFamily ?? "unknown",
    record.creativeDirection ?? "unknown",
    record.buyerIntentLevel ?? "unknown",
    record.productFocus ?? "unknown",
    record.useCaseVertical ?? "unknown",
    record.urgencyMode ?? "unknown",
    record.ctaMode ?? "unknown",
    record.imageStyleFamily ?? "none",
    record.imageShotType ?? "none",
  ].join("|");
}

function aggregateStrategyClusters(records: TweetAnalyticsRecord[], date: Date): CanopyWinnerCluster[] {
  const buckets = new Map<string, TweetAnalyticsRecord[]>();
  for (const record of records) {
    const id = strategyEnvelopeId(record);
    const bucket = buckets.get(id) ?? [];
    bucket.push(record);
    buckets.set(id, bucket);
  }
  return [...buckets.entries()]
    .map(([id, bucket]) => {
      const first = bucket[0]!;
      return {
        strategyEnvelopeId: id,
        sampleSize: bucket.length,
        avgScore: averageHybrid(bucket, date),
        fields: {
          pillarId: first.campaignStrategyId ?? "unknown",
          seriesId: first.seriesId ?? "unknown",
          contentBucket: first.contentBucket ?? "unknown",
          voiceFamily: first.voiceFamily ?? "unknown",
          creativeDirection: first.creativeDirection ?? "unknown",
          buyerIntentLevel: first.buyerIntentLevel ?? "unknown",
          productFocus: first.productFocus ?? "unknown",
          useCaseVertical: first.useCaseVertical ?? "unknown",
          urgencyMode: first.urgencyMode ?? "unknown",
          ctaMode: first.ctaMode ?? "unknown",
          imageStyleFamily: first.imageStyleFamily,
          imageShotType: first.imageShotType,
        },
      };
    })
    .sort((a, b) => b.avgScore - a.avgScore || b.sampleSize - a.sampleSize);
}

function deterministicIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 37 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

function pickValue(
  stats: CanopyDimensionStat[],
  fallbackValues: string[],
  seed: string,
  agentMode: CanopyAgentMode
): { value: string; why: string } {
  const eligible = stats.length > 0 ? stats : fallbackValues.map((value) => ({
    dimension: "fallback",
    value,
    sampleSize: 0,
    weightedScore: 1,
    avgScore: 1,
    recentShare: 0,
  }));
  const filtered = eligible.filter((row) => row.recentShare < MAX_DIMENSION_SHARE || row.sampleSize < MIN_PROMOTION_SAMPLE);
  const pool = filtered.length > 0 ? filtered : eligible;
  if (agentMode === "explore") {
    const underSampled = pool.filter((row) => row.sampleSize < MIN_PROMOTION_SAMPLE + 1);
    const explorePool = underSampled.length > 0 ? underSampled : pool.slice().reverse();
    const picked = explorePool[deterministicIndex(seed, explorePool.length)]!;
    return { value: picked.value, why: `exploration selected ${picked.value}` };
  }
  const picked = pool[0]!;
  return { value: picked.value, why: `${picked.value} is outperforming peers on X` };
}

function topDimensionValue(memory: CanopyAgentMemory, dimension: string): string | null {
  return memory.dimensions[dimension]?.[0]?.value ?? null;
}

function dimensionStat(memory: CanopyAgentMemory, dimension: string, value: string): CanopyDimensionStat | undefined {
  return memory.dimensions[dimension]?.find((row) => row.value === value);
}

function bucketWeight(memory: CanopyAgentMemory, bucket: CanopyContentBucket): number {
  const stat = memory.dimensions.contentBucket?.find((row) => row.value === bucket);
  const target = CONTENT_BUCKET_TARGETS[bucket];
  const recent = stat?.recentShare ?? 0;
  const performance = stat?.weightedScore ?? Math.max(memory.averageHybridScore, 1);
  const baseline = Math.max(memory.averageHybridScore, 1);
  const targetGap = target / Math.max(0.08, recent || 0.08);
  return targetGap * (performance / baseline);
}

function pickContentBucket(memory: CanopyAgentMemory, seed: string, agentMode: CanopyAgentMode): { value: CanopyContentBucket; why: string } {
  const ranked = (Object.keys(CONTENT_BUCKET_TARGETS) as CanopyContentBucket[])
    .map((bucket) => ({
      bucket,
      weight: bucketWeight(memory, bucket),
      recentShare: memory.dimensions.contentBucket?.find((row) => row.value === bucket)?.recentShare ?? 0,
    }))
    .sort((a, b) => b.weight - a.weight || a.bucket.localeCompare(b.bucket));
  if (agentMode === "explore") {
    const underTarget = ranked.filter((row) => row.recentShare < CONTENT_BUCKET_TARGETS[row.bucket]);
    const pool = underTarget.length > 0 ? underTarget : ranked;
    const picked = pool[deterministicIndex(`${seed}:bucket`, pool.length)]!;
    return { value: picked.bucket, why: `exploration selected ${picked.bucket} to rebalance the canopy mix` };
  }
  const picked = ranked[0]!;
  return { value: picked.bucket, why: `${picked.bucket} content is due based on the 60/20/10/10 canopy mix` };
}

function seriesWeight(memory: CanopyAgentMemory, seriesId: CanopySeriesId): number {
  const stat = dimensionStat(memory, "seriesId", seriesId);
  const target = SERIES_TARGETS[seriesId];
  const recent = stat?.recentShare ?? 0;
  const performance = stat?.weightedScore ?? Math.max(memory.averageHybridScore, 1);
  const baseline = Math.max(memory.averageHybridScore, 1);
  const targetGap = target / Math.max(0.06, recent || 0.06);
  const launchPenalty = seriesId === "utah_event_radar" ? 0.72 : 1;
  return targetGap * (performance / baseline) * launchPenalty;
}

function pickSeries(
  memory: CanopyAgentMemory,
  recentRecords: TweetAnalyticsRecord[],
  bucketPillars: ContentPillar[],
  seed: string,
  agentMode: CanopyAgentMode
): { value: CanopySeriesId; why: string } {
  const candidates = [...new Set(bucketPillars.map((pillar) => pillar.seriesId))];
  const recentSeries = recentRecords
    .slice(0, SERIES_COOLDOWN_POSTS)
    .map((record) => record.seriesId)
    .filter((value): value is CanopySeriesId => typeof value === "string") as CanopySeriesId[];
  const ranked = candidates
    .map((seriesId) => {
      const stat = dimensionStat(memory, "seriesId", seriesId);
      const onCooldown = recentSeries.includes(seriesId);
      const weight = seriesWeight(memory, seriesId) * (onCooldown ? 0.35 : 1);
      return {
        seriesId,
        weight,
        recentShare: stat?.recentShare ?? 0,
        sampleSize: stat?.sampleSize ?? 0,
        onCooldown,
      };
    })
    .sort((a, b) => b.weight - a.weight || a.seriesId.localeCompare(b.seriesId));
  if (agentMode === "explore") {
    const underTarget = ranked.filter((row) => row.recentShare < SERIES_TARGETS[row.seriesId]);
    const cooldownSafe = underTarget.filter((row) => !row.onCooldown);
    const pool = cooldownSafe.length > 0 ? cooldownSafe : underTarget.length > 0 ? underTarget : ranked;
    const picked = pool[deterministicIndex(`${seed}:series`, pool.length)]!;
    return { value: picked.seriesId, why: `exploration selected ${picked.seriesId} to keep the canopy series mix balanced` };
  }
  const noCooldown = ranked.filter((row) => !row.onCooldown);
  const pool = noCooldown.length > 0 ? noCooldown : ranked;
  const picked = pool[0]!;
  const why = picked.onCooldown
    ? `${picked.seriesId} still won despite the short cooldown because it is materially outperforming peers`
    : `${picked.seriesId} is due based on cadence, performance, and launch pacing`;
  return { value: picked.seriesId, why };
}

function defaultBrandTagPolicy(seriesId: CanopySeriesId): CanopyBrandTagPolicy {
  return seriesId === "booth_identity" || seriesId === "proof_in_the_wild" ? "optional" : "none";
}

function chooseBrandTagPolicy(
  memory: CanopyAgentMemory,
  pillar: ContentPillar,
  contentBucket: CanopyContentBucket,
  ctaMode: CanopyCtaMode
): CanopyBrandTagPolicy {
  const recentBrandTagShare = dimensionStat(memory, "brandTagIncluded", "true")?.recentShare ?? 0;
  const basePolicy = pillar.brandTagPolicy ?? defaultBrandTagPolicy(pillar.seriesId);
  if (basePolicy === "none") return "none";
  if (contentBucket !== "promo" && ctaMode !== "soft_commercial" && recentBrandTagShare >= BRAND_TAG_TARGET_SHARE) {
    return "none";
  }
  if ((contentBucket === "promo" || ctaMode === "soft_commercial") && recentBrandTagShare < BRAND_TAG_TARGET_SHARE - 0.08) {
    return "soft_commercial";
  }
  return "optional";
}

export function buildCanopyAgentMemory(store: AnalyticsStore, dateInput?: Date): CanopyAgentMemory {
  const date = nowDate(dateInput);
  const records = canopyRecords(store, date);
  const recentRecords = records.slice(0, RECENT_COUNT);
  const dimensions: CanopyAgentMemory["dimensions"] = {
    pillar: aggregateDimension(records, recentRecords, date, "pillar", (record) => record.campaignStrategyId),
    seriesId: aggregateDimension(records, recentRecords, date, "seriesId", (record) => record.seriesId),
    contentBucket: aggregateDimension(records, recentRecords, date, "contentBucket", (record) => record.contentBucket),
    brandTagIncluded: aggregateDimension(
      records,
      recentRecords,
      date,
      "brandTagIncluded",
      (record) => (typeof record.brandTagIncluded === "boolean" ? String(record.brandTagIncluded) : undefined)
    ),
    voiceFamily: aggregateDimension(records, recentRecords, date, "voiceFamily", (record) => record.voiceFamily),
    creativeDirection: aggregateDimension(records, recentRecords, date, "creativeDirection", (record) => record.creativeDirection),
    buyerIntentLevel: aggregateDimension(records, recentRecords, date, "buyerIntentLevel", (record) => record.buyerIntentLevel),
    productFocus: aggregateDimension(records, recentRecords, date, "productFocus", (record) => record.productFocus),
    useCaseVertical: aggregateDimension(records, recentRecords, date, "useCaseVertical", (record) => record.useCaseVertical),
    urgencyMode: aggregateDimension(records, recentRecords, date, "urgencyMode", (record) => record.urgencyMode),
    ctaMode: aggregateDimension(records, recentRecords, date, "ctaMode", (record) => record.ctaMode),
    imageStyleFamily: aggregateDimension(records, recentRecords, date, "imageStyleFamily", (record) => record.imageStyleFamily),
    imageShotType: aggregateDimension(records, recentRecords, date, "imageShotType", (record) => record.imageShotType),
    hasImage: aggregateDimension(
      records,
      recentRecords,
      date,
      "hasImage",
      (record) => (typeof record.hasImage === "boolean" ? String(record.hasImage) : undefined)
    ),
    openingPattern: aggregateDimension(records, recentRecords, date, "openingPattern", (record) => record.openingPattern),
  };
  const clusters = aggregateStrategyClusters(records, date);
  const winnerClusters = clusters.slice(0, 5);
  const loserClusters = clusters.slice(-3).reverse();
  const overusedWarnings = Object.values(dimensions)
    .flatMap((rows) => rows.filter((row) => row.recentShare >= MAX_DIMENSION_SHARE && row.sampleSize >= MIN_PROMOTION_SAMPLE))
    .map((row) => `${row.dimension}:${row.value}`);
  const explorationTargets = Object.values(dimensions)
    .flatMap((rows) => rows.filter((row) => row.sampleSize < MIN_PROMOTION_SAMPLE))
    .slice(0, 6)
    .map((row) => `${row.dimension}:${row.value}`);
  const summaryParts: string[] = [];
  const topPillar = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "pillar");
  const topSeries = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "seriesId");
  const topBucket = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "contentBucket");
  const topVoice = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "voiceFamily");
  const topCreative = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "creativeDirection");
  const weakOpeners = dimensions.openingPattern.slice(-2).map((row) => row.value);
  const brandTagShare = dimensionStat({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "brandTagIncluded", "true")?.recentShare ?? 0;
  if (topPillar) summaryParts.push(`Top canopy pillar on X lately: ${topPillar}.`);
  if (topSeries) summaryParts.push(`Best recurring series lately: ${topSeries}.`);
  if (topBucket) summaryParts.push(`Most effective content bucket lately: ${topBucket}.`);
  if (topVoice) summaryParts.push(`Best voice family: ${topVoice}.`);
  if (topCreative) summaryParts.push(`Best creative lane: ${topCreative}.`);
  summaryParts.push(`Brand tags showed up in ${(brandTagShare * 100).toFixed(0)}% of recent canopy posts.`);
  if (weakOpeners.length > 0) summaryParts.push(`Weak opening patterns: ${weakOpeners.join(", ")}.`);
  if (explorationTargets.length > 0) summaryParts.push(`Explore next: ${explorationTargets.slice(0, 3).join(", ")}.`);
  return {
    optimizerVersion: AGENT_VERSION,
    performanceWindowLabel: `last_${WINDOW_DAYS}_days`,
    totalPostsConsidered: records.length,
    averageHybridScore: averageHybrid(records, date),
    dimensions,
    winnerClusters,
    loserClusters,
    overusedWarnings,
    explorationTargets,
    lastLessonSummary: summaryParts.join(" ").slice(0, 900),
  };
}

export function buildCanopyAgentLesson(memory: CanopyAgentMemory): string {
  return memory.lastLessonSummary;
}

export function chooseCanopyAgentStrategy(store: AnalyticsStore, dateInput?: Date): CanopyStrategyEnvelope {
  const date = nowDate(dateInput);
  const memory = buildCanopyAgentMemory(store, date);
  const pillars = loadContentPillars();
  if (!pillars || pillars.length === 0) throw new Error("No canopy content pillars available");
  const records = canopyRecords(store, date);
  const recentRecords = records.slice(0, RECENT_COUNT);
  const seed = date.toISOString().slice(0, 10);
  const agentMode: CanopyAgentMode =
    memory.totalPostsConsidered < 6 || deterministicIndex(`${seed}:agent_mode`, 100) < Math.round(EXPLORE_RATE * 100)
      ? "explore"
      : "exploit";

  const contentBucket = pickContentBucket(memory, seed, agentMode);
  const compatiblePillars = pillars.filter((pillar) => pillar.contentBuckets?.includes(contentBucket.value));
  const bucketPillars = compatiblePillars.length > 0 ? compatiblePillars : pillars;
  const seriesChoice = pickSeries(memory, recentRecords, bucketPillars, seed, agentMode);
  const seriesCandidates = bucketPillars.filter((pillar) => pillar.seriesId === seriesChoice.value);
  const pillarPool = seriesCandidates.length > 0 ? seriesCandidates : bucketPillars;
  const pillarRows = pillarPool
    .map((pillar) => {
      const stat = memory.dimensions.pillar.find((row) => row.value === pillar.id);
      return {
        pillar,
        weightedScore: stat?.weightedScore ?? 1,
        recentShare: stat?.recentShare ?? recentShare(recentRecords, (record) => record.campaignStrategyId, pillar.id),
      };
    })
    .sort((a, b) => b.weightedScore - a.weightedScore || a.pillar.name.localeCompare(b.pillar.name));
  const filteredPillarRows = pillarRows.filter((row) => row.recentShare < MAX_DIMENSION_SHARE);
  const pillarCandidates = filteredPillarRows.length > 0 ? filteredPillarRows : pillarRows;
  const pillar = (
    agentMode === "explore"
      ? pillarCandidates[deterministicIndex(`${seed}:pillar:${agentMode}`, pillarCandidates.length)]
      : pillarCandidates[0]
  )?.pillar ?? pillars[0]!;
  const loaded = loadPillarForAngle(pillar.name, date) ?? {
    pillar,
    postIdeas: pillar.postIdeas.slice(0, 3),
    targetAudience: pillar.targetAudiences[0] ?? "event planners and vendors",
  };
  const voice = pickValue(memory.dimensions.voiceFamily, pillar.voiceFamilies ?? ["buyer_intent_detail"], `${seed}:voice`, agentMode);
  const creative = pickValue(memory.dimensions.creativeDirection, pillar.creativeDirections ?? ["customer_showcase"], `${seed}:creative`, agentMode);
  const buyerIntent = pickValue(memory.dimensions.buyerIntentLevel, pillar.buyerIntentLevels ?? ["consideration"], `${seed}:intent`, agentMode);
  const productFocus = pickValue(memory.dimensions.productFocus, pillar.productFocuses ?? ["custom canopies"], `${seed}:product`, agentMode);
  const useCaseVertical = pickValue(memory.dimensions.useCaseVertical, pillar.useCaseVerticals ?? ["trade shows"], `${seed}:vertical`, agentMode);
  const urgencyMode = pickValue(memory.dimensions.urgencyMode, pillar.urgencyModes ?? ["none"], `${seed}:urgency`, agentMode);
  const ctaMode = pickValue(memory.dimensions.ctaMode, pillar.ctaModes ?? ["none"], `${seed}:cta`, agentMode);
  const brandTagPolicy = chooseBrandTagPolicy(memory, pillar, contentBucket.value, ctaMode.value as CanopyCtaMode);
  const contextHints = pillar.contextHints && pillar.contextHints.length > 0 ? pillar.contextHints : ["Stay grounded in what event buyers actually care about."];
  const contextHint = contextHints[deterministicIndex(`${seed}:hint`, contextHints.length)]!;
  const strategyEnvelopeId = [
    pillar.id,
    pillar.seriesId,
    contentBucket.value,
    voice.value,
    creative.value,
    buyerIntent.value,
    productFocus.value,
    useCaseVertical.value,
    urgencyMode.value,
    ctaMode.value,
  ].join("|");
  const reasoning = [
    contentBucket.why,
    seriesChoice.why,
    `${pillar.id} selected inside ${contentBucket.value}`,
    voice.why,
    creative.why,
    productFocus.why,
    `agent mode ${agentMode}`,
  ].join("; ");
  return {
    id: strategyEnvelopeId,
    pillarId: pillar.id,
    seriesId: pillar.seriesId,
    contentBucket: contentBucket.value,
    brandTagPolicy,
    angle: pillar.name,
    voiceFamily: voice.value as CanopyVoiceFamily,
    creativeDirection: creative.value,
    buyerIntentLevel: buyerIntent.value as CanopyBuyerIntentLevel,
    productFocus: productFocus.value,
    useCaseVertical: useCaseVertical.value,
    urgencyMode: urgencyMode.value as CanopyUrgencyMode,
    ctaMode: ctaMode.value as CanopyCtaMode,
    targetAudience: loaded.targetAudience,
    postIdeas: loaded.postIdeas,
    contextHint,
    optimizerVersion: AGENT_VERSION,
    agentMode,
    performanceWindowLabel: memory.performanceWindowLabel,
    agentReasoningSummary: reasoning,
    selectionReason: `${reasoning}. ${memory.lastLessonSummary}`.slice(0, 900),
  };
}

export interface CanopyImagePlan {
  enabled: boolean;
  reason: string;
}

export function chooseCanopyImagePlan(store: AnalyticsStore, strategy: CanopyStrategyEnvelope, dateInput?: Date): CanopyImagePlan {
  const memory = buildCanopyAgentMemory(store, dateInput);
  const imageOn = dimensionStat(memory, "hasImage", "true");
  const imageOff = dimensionStat(memory, "hasImage", "false");
  const imageShare = imageOn?.recentShare ?? 0;
  const imagesOutperform =
    !!imageOn &&
    ((!!imageOff && imageOn.weightedScore >= imageOff.weightedScore * 1.08) || (!imageOff && imageOn.sampleSize >= 3));

  if (strategy.seriesId === "utah_event_radar") {
    return {
      enabled: false,
      reason: "Launch gate prefers text-only for Utah Event Radar until a real event feed exists.",
    };
  }
  if (strategy.seriesId === "booth_hot_take") {
    return {
      enabled: imagesOutperform && imageShare < 0.65,
      reason: imagesOutperform && imageShare < 0.65
        ? "Images are earning their keep without crowding the feed, so this hot-take post can support a visual."
        : "Launch gate prefers text-first hot takes unless image performance clearly beats text-only.",
    };
  }
  if (strategy.seriesId === "vendor_life") {
    return {
      enabled: imagesOutperform && imageShare < 0.65,
      reason: imagesOutperform && imageShare < 0.65
        ? "Vendor-life images are currently outperforming text-only enough to justify a scene."
        : "Vendor-life posts stay text-first unless canopy images materially outperform text-only posts.",
    };
  }
  return {
    enabled: true,
    reason: "This series benefits from product-in-context visuals, so images stay on by default.",
  };
}

export function chooseCanopyImageDirection(store: AnalyticsStore, strategy: CanopyStrategyEnvelope, dateInput?: Date): CampaignImagePromptDetails | null {
  const memory = buildCanopyAgentMemory(store, dateInput);
  const topStyle = memory.dimensions.imageStyleFamily[0]?.value as CanopyImageStyleFamily | undefined;
  const topShot = memory.dimensions.imageShotType[0]?.value as CanopyImageShotType | undefined;
  const preferredStyle =
    strategy.seriesId === "vendor_life" || strategy.seriesId === "utah_event_radar" || strategy.seriesId === "booth_hot_take"
      ? "lifestyle"
      : strategy.seriesId === "proof_in_the_wild" || strategy.creativeDirection === "educational_breakdown" || strategy.creativeDirection === "behind_the_scenes"
        ? (topStyle ?? "mockup")
        : (topStyle ?? undefined);
  const preferredShotType =
    strategy.seriesId === "vendor_life" || strategy.seriesId === "utah_event_radar"
      ? "wide"
      : strategy.seriesId === "proof_in_the_wild" || strategy.creativeDirection === "educational_breakdown"
        ? "close_up"
        : (topShot ?? undefined);
  return buildCampaignImagePromptForAngle(strategy.angle, {
    store,
    date: nowDate(dateInput),
    pillarId: strategy.pillarId,
    preferredStyle,
    preferredShotType,
    preferredUseCaseVertical: strategy.useCaseVertical,
    preferredProductFocus: strategy.productFocus,
  });
}

const CANOPY_RULE_PENALTIES: Array<{ pattern: RegExp; penalty: number }> = [
  { pattern: /\bstand out\b/i, penalty: 12 },
  { pattern: /\bgrab attention\b/i, penalty: 12 },
  { pattern: /\bmake an impact\b/i, penalty: 10 },
  { pattern: /\bsmart buying\b/i, penalty: 8 },
  { pattern: /\bnot a myth\b/i, penalty: 8 },
  { pattern: /\bturn heads\b/i, penalty: 10 },
  { pattern: /\bmake it count\b/i, penalty: 14 },
  { pattern: /\byour first impression\b/i, penalty: 10 },
  { pattern: /\btells a story\b/i, penalty: 10 },
  { pattern: /\bbooth impression hack\b/i, penalty: 14 },
  { pattern: /\bbefore you even say a word\b/i, penalty: 12 },
  { pattern: /\bdoes the talking\b/i, penalty: 12 },
  { pattern: /\bvibe check\b/i, penalty: 12 },
  { pattern: /\bvibes\b/i, penalty: 10 },
  { pattern: /\bwinging it\b/i, penalty: 10 },
  { pattern: /\bsilent reviewer\b/i, penalty: 10 },
  { pattern: /\bstory at a glance\b/i, penalty: 10 },
  { pattern: /\btells everyone your story\b/i, penalty: 10 },
  { pattern: /\bfirst impression\b/i, penalty: 10 },
  { pattern: /\bisn't a checklist\b/i, penalty: 10 },
  { pattern: /\bwhether you notice it or not\b/i, penalty: 10 },
  { pattern: /\bcurated expertise\b/i, penalty: 10 },
  { pattern: /\bpremium\b/i, penalty: 8 },
  { pattern: /\bquote\b/i, penalty: 15 },
  { pattern: /\bdm us\b/i, penalty: 16 },
  { pattern: /\blink in bio\b/i, penalty: 16 },
];

function fieldDetailBonus(text: string): number {
  const matches = text.match(/\baisle\b|\bparking lot\b|\bpaid spot\b|\bvalance\b|\bframe\b|\bdrooping vinyl\b|\brush order\b|\breplacement\b|\bsetup window\b|\bwind\b|\bbooth\b|\btent\b|\bfeather flag\b|\bbanner\b|\bdye sublimation\b/gi);
  return Math.min(20, (matches?.length ?? 0) * 4);
}

function localSignalBonus(text: string): number {
  const matches = text.match(/\butah\b|\bsalt lake\b|\butah county\b|\bprovo\b|\bogden\b|\bst\.?\s*george\b|\bmountain west\b|\bfarmers market\b|\bfair\b|\bfestival\b|\bexpo\b/gi);
  return Math.min(16, (matches?.length ?? 0) * 4);
}

function screenshotWorthyBonus(text: string): number {
  let score = 0;
  if (/^(hot take|vendor life|classic market truth|utah event season|booth fashion report)/i.test(text)) score += 8;
  if (/\bbut\b|\binstead\b|\btruth\b|\bproblem\b|\bnot\b/i.test(text)) score += 6;
  return score;
}

function hasBrandTag(text: string): boolean {
  return text.includes("Vicious Shade Supply Co.") || text.includes("viciousshade.com");
}

export function scoreCanopyCandidate(text: string, strategy: CanopyStrategyEnvelope): number {
  let score = 55;
  score += fieldDetailBonus(text);
  score += localSignalBonus(text);
  score += screenshotWorthyBonus(text);
  if (text.length >= 140 && text.length <= 250) score += 8;
  if (text.includes(strategy.productFocus)) score += 8;
  if (text.toLowerCase().includes(strategy.useCaseVertical.toLowerCase())) score += 6;
  if (/\bwind\b|\bframe\b|\bvalance\b|\btrade show\b|\bfestival\b|\bmarket\b|\brush\b/i.test(text)) score += 8;
  if (strategy.seriesId === "utah_event_radar" && /\butah\b|\bsalt lake\b|\butah county\b|\bprovo\b|\bogden\b|\bst\.?\s*george\b/i.test(text)) score += 12;
  if (strategy.seriesId === "vendor_life" && /\b5 a\.?m\b|\bload-?in\b|\bsetup\b|\bparking lot\b|\bvan\b|\bwind\b/i.test(text)) score += 12;
  if (strategy.seriesId === "booth_hot_take" && /\bhot take\b|\btaste problem\b|\bfolding table\b|\bgarage sale\b|\bmismatched\b/i.test(text)) score += 12;
  if ((strategy.brandTagPolicy === "none" || (strategy.brandTagPolicy === "optional" && strategy.contentBucket !== "promo" && strategy.ctaMode !== "soft_commercial")) && hasBrandTag(text)) {
    score -= 12;
  }
  if ((text.match(/\?/g) ?? []).length > 1) score -= 12;
  for (const entry of CANOPY_RULE_PENALTIES) {
    if (entry.pattern.test(text)) score -= entry.penalty;
  }
  if (/\bvisibility\b/.test(text) && !/\baisle\b|\bparking lot\b|\b50 feet\b|\b100 feet\b/i.test(text)) score -= 6;
  return score;
}

export interface CanopyRankedCandidate {
  candidateId: string;
  text: string;
  ruleScore: number;
  judgeScore: number;
  totalScore: number;
  rank: number;
  rejectionReason?: string;
}

export function rankCanopyCandidates(texts: string[], strategy: CanopyStrategyEnvelope): CanopyRankedCandidate[] {
  const unique = [...new Set(texts.map((text) => text.trim()).filter(Boolean))];
  const rows = unique.map((text, index) => {
    const ruleScore = scoreCanopyCandidate(text, strategy);
    return {
      candidateId: `${strategy.id}:candidate:${index + 1}`,
      text,
      ruleScore,
      judgeScore: 0,
      totalScore: ruleScore,
    };
  });
  return rows
    .sort((a, b) => b.totalScore - a.totalScore || a.text.length - b.text.length)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function formatCanopyAgentReport(memory: CanopyAgentMemory): string {
  const lines: string[] = [];
  const brandTagShare = dimensionStat(memory, "brandTagIncluded", "true")?.recentShare ?? 0;
  const imageShare = dimensionStat(memory, "hasImage", "true")?.recentShare ?? 0;
  lines.push(`# Canopy agent report (${new Date().toISOString()})`);
  lines.push(`Performance window: ${memory.performanceWindowLabel}`);
  lines.push(`Canopy posts considered: ${memory.totalPostsConsidered}`);
  lines.push(`Average hybrid X score: ${memory.averageHybridScore.toFixed(2)}`);
  lines.push(`Recent brand-tag share: ${(brandTagShare * 100).toFixed(0)}%`);
  lines.push(`Recent image share: ${(imageShare * 100).toFixed(0)}%`);
  lines.push("");
  lines.push("## Launch pacing");
  for (const seriesId of Object.keys(SERIES_TARGETS) as CanopySeriesId[]) {
    const share = dimensionStat(memory, "seriesId", seriesId)?.recentShare ?? 0;
    lines.push(`- ${seriesId}: ${(share * 100).toFixed(0)}% recent share vs ${(SERIES_TARGETS[seriesId] * 100).toFixed(0)}% target`);
  }
  lines.push("");
  lines.push("## What the agent believes is working");
  for (const cluster of memory.winnerClusters.slice(0, 3)) {
    lines.push(`- ${cluster.strategyEnvelopeId} (${cluster.sampleSize} post(s), avg ${cluster.avgScore.toFixed(2)})`);
  }
  lines.push("");
  lines.push("## What the agent is avoiding");
  for (const cluster of memory.loserClusters.slice(0, 3)) {
    lines.push(`- ${cluster.strategyEnvelopeId} (${cluster.sampleSize} post(s), avg ${cluster.avgScore.toFixed(2)})`);
  }
  lines.push("");
  lines.push("## What the agent is testing next");
  if (memory.explorationTargets.length === 0) lines.push("- No urgent exploration targets.");
  else for (const target of memory.explorationTargets.slice(0, 5)) lines.push(`- ${target}`);
  lines.push("");
  lines.push("## Lesson");
  lines.push(memory.lastLessonSummary || "- Not enough canopy signal yet.");
  return lines.join("\n");
}
