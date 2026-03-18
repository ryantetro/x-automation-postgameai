/**
 * Load content pillars from campaign content-pillars.json.
 * Used by angles_only campaigns (e.g. canopy) to inject pillar and strategy data into generation.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { CAMPAIGNS_DIR } from "./config.js";
import type {
  CanopyBrandTagPolicy,
  AnalyticsStore,
  CanopyBuyerIntentLevel,
  CanopyContentBucket,
  CanopyCtaMode,
  CanopySeriesId,
  CanopyUrgencyMode,
  CanopyVoiceFamily,
  TweetAnalyticsRecord,
} from "./analytics.js";

export interface ContentPillar {
  id: string;
  name: string;
  seriesId: CanopySeriesId;
  contentBuckets: CanopyContentBucket[];
  brandTagPolicy?: CanopyBrandTagPolicy;
  postIdeas: string[];
  examplePost?: string;
  targetAudiences: string[];
  voiceFamilies?: CanopyVoiceFamily[];
  buyerIntentLevels?: CanopyBuyerIntentLevel[];
  productFocuses?: string[];
  useCaseVerticals?: string[];
  urgencyModes?: CanopyUrgencyMode[];
  ctaModes?: CanopyCtaMode[];
  contextHints?: string[];
  creativeDirections?: string[];
}

interface ContentPillarsData {
  pillars: ContentPillar[];
}

export interface LoadedPillarData {
  pillar: ContentPillar;
  postIdeas: string[];
  targetAudience: string;
}

export interface CanopyStrategySelection {
  angle: string;
  pillarId: string;
  targetAudience: string;
  postIdeas: string[];
  voiceFamily: CanopyVoiceFamily;
  buyerIntentLevel: CanopyBuyerIntentLevel;
  useCaseVertical: string;
  productFocus: string;
  urgencyMode: CanopyUrgencyMode;
  ctaMode: CanopyCtaMode;
  contextHint: string;
  creativeDirection: string;
  optimizerVersion: string;
  selectionReason: string;
  seriesId: CanopySeriesId;
  contentBucket: CanopyContentBucket;
  brandTagPolicy: CanopyBrandTagPolicy;
}

const OPTIMIZER_VERSION = "canopy_optimizer_v1";
const EXPLORATION_RATE = 0.22;
const RECENT_WINDOW = 24;
const OVERUSE_CAP = 0.45;

let cachedPillars: ContentPillar[] | null | undefined;

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000));
}

export function loadContentPillars(): ContentPillar[] | null {
  if (cachedPillars !== undefined) return cachedPillars;
  const slug = process.env.CAMPAIGN?.trim();
  if (!slug) {
    cachedPillars = null;
    return null;
  }
  const path = resolve(CAMPAIGNS_DIR, slug, "content-pillars.json");
  if (!existsSync(path)) {
    cachedPillars = null;
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as ContentPillarsData;
    cachedPillars = Array.isArray(data.pillars) ? data.pillars : null;
    return cachedPillars;
  } catch {
    cachedPillars = null;
    return null;
  }
}

export function loadPillarForAngle(angle: string, date: Date): LoadedPillarData | null {
  const pillars = loadContentPillars();
  if (!pillars) return null;
  const pillar = pillars.find((p) => p.name === angle);
  if (!pillar) return null;
  const idx = dayOfYear(date);
  const audiences = pillar.targetAudiences.length > 0 ? pillar.targetAudiences : ["event planners and vendors"];
  return {
    pillar,
    postIdeas: pillar.postIdeas.slice(0, 3),
    targetAudience: audiences[idx % audiences.length],
  };
}

function canopyRecords(store: AnalyticsStore): TweetAnalyticsRecord[] {
  return store.tweets
    .filter((tweet) => tweet.status === "posted")
    .filter((tweet) => tweet.sport === "canopy");
}

function recordScore(record: TweetAnalyticsRecord): number {
  if (typeof record.score === "number") return record.score;
  const impressions = record.metrics?.impressionCount ?? 0;
  const engagements = record.metrics?.engagementCount ?? 0;
  return impressions + engagements * 25;
}

function averageScore(records: TweetAnalyticsRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((sum, record) => sum + recordScore(record), 0) / records.length;
}

function recentValueShare(records: TweetAnalyticsRecord[], getValue: (record: TweetAnalyticsRecord) => string | undefined, value: string): number {
  if (records.length === 0) return 0;
  const hits = records.filter((record) => getValue(record) === value).length;
  return hits / records.length;
}

function performanceWeight(records: TweetAnalyticsRecord[], candidateValue: string, getValue: (record: TweetAnalyticsRecord) => string | undefined): number {
  const matching = records.filter((record) => getValue(record) === candidateValue);
  if (matching.length === 0) return 1;
  const overall = Math.max(1, averageScore(records));
  const candidate = averageScore(matching);
  const sampleBoost = Math.min(0.75, matching.length * 0.08);
  return Math.max(0.35, 0.9 + candidate / overall + sampleBoost);
}

function deterministicIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

function pickWeighted<T extends string>(
  values: T[],
  records: TweetAnalyticsRecord[],
  recentRecords: TweetAnalyticsRecord[],
  seed: string,
  getValue: (record: TweetAnalyticsRecord) => string | undefined
): { value: T; rationale: string } {
  if (values.length === 0) {
    throw new Error("pickWeighted requires at least one candidate");
  }
  const explore = recentRecords.length < 6 || deterministicIndex(`${seed}:explore`, 100) < Math.round(EXPLORATION_RATE * 100);
  const ranked = values.map((value) => {
    const overused = recentValueShare(recentRecords, getValue, value) >= OVERUSE_CAP;
    const weight = explore ? 1 : performanceWeight(records, value, getValue) * (overused ? 0.45 : 1);
    return { value, weight, overused };
  });
  ranked.sort((a, b) => b.weight - a.weight || String(a.value).localeCompare(String(b.value)));
  if (explore) {
    const index = deterministicIndex(seed, ranked.length);
    return {
      value: ranked[index]!.value,
      rationale: `exploration kept ${String(ranked[index]!.value)} in rotation`,
    };
  }
  return {
    value: ranked[0]!.value,
    rationale: ranked[0]!.overused
      ? `${String(ranked[0]!.value)} still won despite recent overuse guardrails`
      : `${String(ranked[0]!.value)} is currently outperforming peers`,
  };
}

export function chooseCanopyStrategy(store: AnalyticsStore, date: Date): CanopyStrategySelection {
  const pillars = loadContentPillars();
  if (!pillars || pillars.length === 0) {
    throw new Error("No canopy content pillars available");
  }

  const allRecords = canopyRecords(store).sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  const recentRecords = allRecords.slice(0, RECENT_WINDOW);
  const pillarSeed = `${date.toISOString().slice(0, 10)}:pillar`;
  const pillarChoice = pickWeighted(
    pillars.map((pillar) => pillar.name),
    allRecords,
    recentRecords,
    pillarSeed,
    (record) => record.angle
  );
  const pillar = pillars.find((candidate) => candidate.name === pillarChoice.value) ?? pillars[0]!;
  const loaded = loadPillarForAngle(pillar.name, date) ?? {
    pillar,
    postIdeas: pillar.postIdeas.slice(0, 3),
    targetAudience: pillar.targetAudiences[0] ?? "event planners and vendors",
  };

  const voice = pickWeighted(
    pillar.voiceFamilies && pillar.voiceFamilies.length > 0
      ? pillar.voiceFamilies
      : ["observational_thought_leadership", "buyer_intent_detail"],
    allRecords,
    recentRecords,
    `${pillarSeed}:voice`,
    (record) => record.voiceFamily
  );
  const buyerIntent = pickWeighted(
    pillar.buyerIntentLevels && pillar.buyerIntentLevels.length > 0
      ? pillar.buyerIntentLevels
      : ["consideration"],
    allRecords,
    recentRecords,
    `${pillarSeed}:intent`,
    (record) => record.buyerIntentLevel
  );
  const useCaseVerticals = pillar.useCaseVerticals && pillar.useCaseVerticals.length > 0
    ? pillar.useCaseVerticals
    : ["trade shows"];
  const vertical = pickWeighted(
    useCaseVerticals,
    allRecords,
    recentRecords,
    `${pillarSeed}:vertical`,
    (record) => record.useCaseVertical
  );
  const productFocuses = pillar.productFocuses && pillar.productFocuses.length > 0
    ? pillar.productFocuses
    : ["custom canopies"];
  const productFocus = pickWeighted(
    productFocuses,
    allRecords,
    recentRecords,
    `${pillarSeed}:product`,
    (record) => record.productFocus
  );
  const urgencyModes: CanopyUrgencyMode[] =
    pillar.urgencyModes && pillar.urgencyModes.length > 0 ? pillar.urgencyModes : ["none"];
  const urgency = pickWeighted(
    urgencyModes,
    allRecords,
    recentRecords,
    `${pillarSeed}:urgency`,
    (record) => record.urgencyMode
  );
  const ctaModes: CanopyCtaMode[] =
    pillar.ctaModes && pillar.ctaModes.length > 0 ? pillar.ctaModes : ["none"];
  const cta = pickWeighted(
    ctaModes,
    allRecords,
    recentRecords,
    `${pillarSeed}:cta`,
    (record) => record.ctaMode
  );
  const hints = pillar.contextHints && pillar.contextHints.length > 0 ? pillar.contextHints : ["Stay grounded in what event buyers actually care about."];
  const hint = hints[deterministicIndex(`${pillarSeed}:hint`, hints.length)]!;
  const creativeDirections = pillar.creativeDirections && pillar.creativeDirections.length > 0
    ? pillar.creativeDirections
    : ["customer_showcase"];
  const creativeDirection = pickWeighted(
    creativeDirections,
    allRecords,
    recentRecords,
    `${pillarSeed}:creative_direction`,
    (record) => record.creativeDirection
  );

  return {
    angle: pillar.name,
    pillarId: pillar.id,
    seriesId: pillar.seriesId,
    contentBucket: pillar.contentBuckets?.[0] ?? "culture",
    brandTagPolicy: pillar.brandTagPolicy ?? (pillar.seriesId === "booth_identity" || pillar.seriesId === "proof_in_the_wild" ? "optional" : "none"),
    targetAudience: loaded.targetAudience,
    postIdeas: loaded.postIdeas,
    voiceFamily: voice.value,
    buyerIntentLevel: buyerIntent.value,
    useCaseVertical: vertical.value,
    productFocus: productFocus.value,
    urgencyMode: urgency.value,
    ctaMode: cta.value,
    contextHint: hint,
    creativeDirection: creativeDirection.value,
    optimizerVersion: OPTIMIZER_VERSION,
    selectionReason: [
      pillarChoice.rationale,
      voice.rationale,
      productFocus.rationale,
      urgency.rationale,
      creativeDirection.rationale,
    ].join("; "),
  };
}

function topDimension(records: TweetAnalyticsRecord[], getValue: (record: TweetAnalyticsRecord) => string | undefined): string | null {
  const map = new Map<string, TweetAnalyticsRecord[]>();
  for (const record of records) {
    const value = getValue(record);
    if (!value) continue;
    const bucket = map.get(value) ?? [];
    bucket.push(record);
    map.set(value, bucket);
  }
  const rows = [...map.entries()]
    .map(([value, bucket]) => ({ value, score: averageScore(bucket), count: bucket.length }))
    .sort((a, b) => b.score - a.score || b.count - a.count);
  return rows[0]?.value ?? null;
}

export function buildCanopyIterationGuidance(store: AnalyticsStore): string | null {
  const records = canopyRecords(store)
    .filter((record) => (record.metrics?.impressionCount ?? 0) > 0 || typeof record.score === "number")
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, 30);
  if (records.length < 4) return null;

  const topPillar = topDimension(records, (record) => record.angle);
  const topVoice = topDimension(records, (record) => record.voiceFamily);
  const topCreativeDirection = topDimension(records, (record) => record.creativeDirection);
  const topImageStyle = topDimension(records, (record) => record.imageStyleFamily);
  const topShot = topDimension(records, (record) => record.imageShotType);

  const openerCounts = new Map<string, number>();
  for (const record of records) {
    if (!record.openingPattern) continue;
    openerCounts.set(record.openingPattern, (openerCounts.get(record.openingPattern) ?? 0) + 1);
  }
  const avoidOpener = [...openerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const lines: string[] = [];
  if (topPillar) lines.push(`Recent canopy winners are clustered around the "${topPillar}" pillar.`);
  if (topVoice) lines.push(`The strongest voice family lately is ${topVoice.replaceAll("_", " ")}.`);
  if (topCreativeDirection) lines.push(`The best-performing creative lane lately is ${topCreativeDirection.replaceAll("_", " ")}.`);
  if (topImageStyle && topShot) lines.push(`Visuals are landing best with ${topImageStyle} imagery in ${topShot.replaceAll("_", " ")} shots.`);
  if (avoidOpener) lines.push(`Avoid overusing the ${avoidOpener.replaceAll("_", " ")} opener pattern.`);
  const underusedVoice = topDimension(
    records.filter((record) => !record.voiceFamily || recentValueShare(records, (row) => row.voiceFamily, record.voiceFamily) < 0.18),
    (record) => record.voiceFamily
  );
  if (underusedVoice) lines.push(`Keep exploration alive by giving ${underusedVoice.replaceAll("_", " ")} another clean test.`);
  return lines.length > 0 ? lines.join(" ").slice(0, 900) : null;
}
