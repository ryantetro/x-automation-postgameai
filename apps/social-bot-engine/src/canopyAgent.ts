import type {
  AnalyticsStore,
  CanopyAgentMode,
  CanopyBuyerIntentLevel,
  CanopyCtaMode,
  CanopyImageShotType,
  CanopyImageStyleFamily,
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
const AGENT_VERSION = "canopy_agent_v1";

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

function strategyEnvelopeId(record: Pick<TweetAnalyticsRecord, "campaignStrategyId" | "voiceFamily" | "creativeDirection" | "buyerIntentLevel" | "productFocus" | "useCaseVertical" | "urgencyMode" | "ctaMode" | "imageStyleFamily" | "imageShotType">): string {
  return [
    record.campaignStrategyId ?? "unknown",
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

export function buildCanopyAgentMemory(store: AnalyticsStore, dateInput?: Date): CanopyAgentMemory {
  const date = nowDate(dateInput);
  const records = canopyRecords(store, date);
  const recentRecords = records.slice(0, RECENT_COUNT);
  const dimensions: CanopyAgentMemory["dimensions"] = {
    pillar: aggregateDimension(records, recentRecords, date, "pillar", (record) => record.campaignStrategyId),
    voiceFamily: aggregateDimension(records, recentRecords, date, "voiceFamily", (record) => record.voiceFamily),
    creativeDirection: aggregateDimension(records, recentRecords, date, "creativeDirection", (record) => record.creativeDirection),
    buyerIntentLevel: aggregateDimension(records, recentRecords, date, "buyerIntentLevel", (record) => record.buyerIntentLevel),
    productFocus: aggregateDimension(records, recentRecords, date, "productFocus", (record) => record.productFocus),
    useCaseVertical: aggregateDimension(records, recentRecords, date, "useCaseVertical", (record) => record.useCaseVertical),
    urgencyMode: aggregateDimension(records, recentRecords, date, "urgencyMode", (record) => record.urgencyMode),
    ctaMode: aggregateDimension(records, recentRecords, date, "ctaMode", (record) => record.ctaMode),
    imageStyleFamily: aggregateDimension(records, recentRecords, date, "imageStyleFamily", (record) => record.imageStyleFamily),
    imageShotType: aggregateDimension(records, recentRecords, date, "imageShotType", (record) => record.imageShotType),
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
  const topVoice = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "voiceFamily");
  const topCreative = topDimensionValue({ optimizerVersion: AGENT_VERSION, performanceWindowLabel: "", totalPostsConsidered: 0, averageHybridScore: 0, dimensions, winnerClusters, loserClusters, overusedWarnings, explorationTargets, lastLessonSummary: "" }, "creativeDirection");
  const weakOpeners = dimensions.openingPattern.slice(-2).map((row) => row.value);
  if (topPillar) summaryParts.push(`Top canopy pillar on X lately: ${topPillar}.`);
  if (topVoice) summaryParts.push(`Best voice family: ${topVoice}.`);
  if (topCreative) summaryParts.push(`Best creative lane: ${topCreative}.`);
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
  const seed = date.toISOString().slice(0, 10);
  const agentMode: CanopyAgentMode =
    memory.totalPostsConsidered < 6 || deterministicIndex(`${seed}:agent_mode`, 100) < Math.round(EXPLORE_RATE * 100)
      ? "explore"
      : "exploit";

  const pillarValue = pickValue(memory.dimensions.pillar, pillars.map((pillar) => pillar.id), `${seed}:pillar`, agentMode);
  const pillar = pillars.find((candidate) => candidate.id === pillarValue.value) ?? pillars[0]!;
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
  const contextHints = pillar.contextHints && pillar.contextHints.length > 0 ? pillar.contextHints : ["Stay grounded in what event buyers actually care about."];
  const contextHint = contextHints[deterministicIndex(`${seed}:hint`, contextHints.length)]!;
  const strategyEnvelopeId = [
    pillar.id,
    voice.value,
    creative.value,
    buyerIntent.value,
    productFocus.value,
    useCaseVertical.value,
    urgencyMode.value,
    ctaMode.value,
  ].join("|");
  const reasoning = [
    pillarValue.why,
    voice.why,
    creative.why,
    productFocus.why,
    `agent mode ${agentMode}`,
  ].join("; ");
  return {
    id: strategyEnvelopeId,
    pillarId: pillar.id,
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

export function chooseCanopyImageDirection(store: AnalyticsStore, strategy: CanopyStrategyEnvelope, dateInput?: Date): CampaignImagePromptDetails | null {
  const memory = buildCanopyAgentMemory(store, dateInput);
  const topStyle = memory.dimensions.imageStyleFamily[0]?.value as CanopyImageStyleFamily | undefined;
  const topShot = memory.dimensions.imageShotType[0]?.value as CanopyImageShotType | undefined;
  const preferredStyle =
    strategy.creativeDirection === "customer_showcase" || strategy.creativeDirection === "before_after_transformation" || strategy.creativeDirection === "seasonal_urgency"
      ? "lifestyle"
      : strategy.creativeDirection === "educational_breakdown" || strategy.creativeDirection === "behind_the_scenes"
        ? (topStyle ?? "mockup")
        : (topStyle ?? undefined);
  const preferredShotType =
    strategy.creativeDirection === "customer_showcase"
      ? "wide"
      : strategy.creativeDirection === "educational_breakdown"
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
];

function fieldDetailBonus(text: string): number {
  const matches = text.match(/\baisle\b|\bparking lot\b|\bpaid spot\b|\bvalance\b|\bframe\b|\bdrooping vinyl\b|\brush order\b|\breplacement\b|\bsetup window\b|\bwind\b|\bbooth\b|\btent\b|\bfeather flag\b|\bbanner\b|\bdye sublimation\b/gi);
  return Math.min(20, (matches?.length ?? 0) * 4);
}

export function scoreCanopyCandidate(text: string, strategy: CanopyStrategyEnvelope): number {
  let score = 55;
  score += fieldDetailBonus(text);
  if (text.length >= 140 && text.length <= 250) score += 8;
  if (text.includes(strategy.productFocus)) score += 8;
  if (text.toLowerCase().includes(strategy.useCaseVertical.toLowerCase())) score += 6;
  if (/\bwind\b|\bframe\b|\bvalance\b|\btrade show\b|\bfestival\b|\bmarket\b|\brush\b/i.test(text)) score += 8;
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
  lines.push(`# Canopy agent report (${new Date().toISOString()})`);
  lines.push(`Performance window: ${memory.performanceWindowLabel}`);
  lines.push(`Canopy posts considered: ${memory.totalPostsConsidered}`);
  lines.push(`Average hybrid X score: ${memory.averageHybridScore.toFixed(2)}`);
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
