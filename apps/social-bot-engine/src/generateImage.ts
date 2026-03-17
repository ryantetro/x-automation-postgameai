/**
 * AI-generated images for campaigns with imageEnabled=true.
 * Loads prompt variants from campaigns/<slug>/image-prompts.json and selects an image concept automatically.
 */
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import {
  OPENAI_API_KEY,
  IMAGE_MODEL,
  CAMPAIGNS_DIR,
} from "./config.js";
import type {
  AnalyticsStore,
  CanopyImageShotType,
  CanopyImageStyleFamily,
  TweetAnalyticsRecord,
} from "./analytics.js";
import { loadContentPillars } from "./contentPillars.js";

export interface ImageVariantConfig {
  id: string;
  pillarId: string;
  prompt: string;
  style: CanopyImageStyleFamily;
  shotType: CanopyImageShotType;
  useCaseVertical?: string;
  productFocus?: string;
  aesthetic?: string;
  referenceImage?: string;
  weight?: number;
}

interface ImagePromptsConfig {
  mockupSuffix: string;
  lifestyleSuffix: string;
  negativePrompt?: string;
  variants: ImageVariantConfig[];
  size?: string;
  quality?: string;
  explorationRate?: number;
}

export interface CampaignImagePromptDetails {
  prompt: string;
  variantId: string;
  pillarId: string;
  sceneIndex: number;
  scene: string;
  style: CanopyImageStyleFamily;
  shotType: CanopyImageShotType;
  useCaseVertical?: string;
  productFocus?: string;
  aesthetic?: string;
  selectionReason: string;
}

interface ImageSelectionOptions {
  store?: AnalyticsStore;
  date?: Date;
  pillarId?: string;
  preferredVariantId?: string;
  preferredStyle?: CanopyImageStyleFamily;
  preferredShotType?: CanopyImageShotType;
  preferredUseCaseVertical?: string;
  preferredProductFocus?: string;
}

let cachedConfig: ImagePromptsConfig | null | undefined;

function loadImagePrompts(): ImagePromptsConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const slug = process.env.CAMPAIGN?.trim();
  if (!slug) {
    cachedConfig = null;
    return null;
  }

  const configPath = resolve(CAMPAIGNS_DIR, slug, "image-prompts.json");
  if (!existsSync(configPath)) {
    console.warn(`No image-prompts.json found at ${configPath}; skipping image generation.`);
    cachedConfig = null;
    return null;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    cachedConfig = JSON.parse(raw) as ImagePromptsConfig;
    return cachedConfig;
  } catch (err) {
    console.warn(`Failed to load image-prompts.json from ${configPath}:`, err);
    cachedConfig = null;
    return null;
  }
}

function canopyImageRecords(store: AnalyticsStore | undefined): TweetAnalyticsRecord[] {
  if (!store) return [];
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

function recentShare(records: TweetAnalyticsRecord[], getValue: (record: TweetAnalyticsRecord) => string | undefined, value: string): number {
  if (records.length === 0) return 0;
  const hits = records.filter((record) => getValue(record) === value).length;
  return hits / records.length;
}

function deterministicIndex(seed: string, length: number): number {
  if (length <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  return hash % length;
}

function buildPrompt(config: ImagePromptsConfig, variant: ImageVariantConfig): string {
  const suffix = variant.style === "mockup" ? config.mockupSuffix : config.lifestyleSuffix;
  let prompt = `${variant.prompt}. ${suffix}`;
  if (variant.aesthetic?.trim()) prompt += ` ${variant.aesthetic.trim()}.`;
  if (config.negativePrompt?.trim()) prompt += ` ${config.negativePrompt.trim()}`;
  return prompt.trim();
}

function resolvePillarId(angle: string): string | null {
  const pillars = loadContentPillars();
  const pillar = pillars?.find((candidate) => candidate.name === angle);
  return pillar?.id ?? null;
}

function pickVariant(config: ImagePromptsConfig, angle: string, options: ImageSelectionOptions): CampaignImagePromptDetails | null {
  const variants = config.variants;
  if (variants.length === 0) return null;

  const pillarId = options.pillarId ?? resolvePillarId(angle);
  const eligible = pillarId ? variants.filter((variant) => variant.pillarId === pillarId) : variants;
  const pool = eligible.length > 0 ? eligible : variants;

  if (options.preferredVariantId) {
    const explicit = pool.find((variant) => variant.id === options.preferredVariantId);
    if (explicit) {
      return {
        prompt: buildPrompt(config, explicit),
        variantId: explicit.id,
        pillarId: explicit.pillarId,
        sceneIndex: pool.findIndex((variant) => variant.id === explicit.id),
        scene: explicit.prompt,
        style: explicit.style,
        shotType: explicit.shotType,
        useCaseVertical: explicit.useCaseVertical,
        productFocus: explicit.productFocus,
        aesthetic: explicit.aesthetic,
        selectionReason: "explicit variant override selected",
      };
    }
  }

  const date = options.date ?? new Date();
  const seed = `${date.toISOString().slice(0, 10)}:${angle}:image`;
  const records = canopyImageRecords(options.store).sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));
  const recent = records.slice(0, 18);
  const explorationRate = config.explorationRate ?? 0.25;
  const explore = recent.length < 6 || deterministicIndex(`${seed}:explore`, 100) < Math.round(explorationRate * 100);

  const overallScore = Math.max(1, averageScore(records));
  const ranked = pool.map((variant, index) => {
    const matching = records.filter((record) => record.imageConceptId === variant.id);
    const conceptScore = matching.length > 0 ? averageScore(matching) / overallScore : 1;
    const styleScore = averageScore(records.filter((record) => record.imageStyleFamily === variant.style)) / overallScore || 1;
    const shotScore = averageScore(records.filter((record) => record.imageShotType === variant.shotType)) / overallScore || 1;
    const overused =
      recentShare(recent, (record) => record.imageConceptId, variant.id) >= 0.45 ||
      recentShare(recent, (record) => record.imageStyleFamily, variant.style) >= 0.6;
    const preferenceBoost =
      (options.preferredStyle && variant.style === options.preferredStyle ? 1.2 : 1) *
      (options.preferredShotType && variant.shotType === options.preferredShotType ? 1.15 : 1) *
      (options.preferredUseCaseVertical && variant.useCaseVertical === options.preferredUseCaseVertical ? 1.15 : 1) *
      (options.preferredProductFocus && variant.productFocus === options.preferredProductFocus ? 1.1 : 1);
    const weight = (variant.weight ?? 1) * preferenceBoost * (explore ? 1 : conceptScore * 0.6 + styleScore * 0.25 + shotScore * 0.15) * (overused ? 0.5 : 1);
    return { variant, index, weight, overused };
  });
  ranked.sort((a, b) => b.weight - a.weight || a.index - b.index);
  const chosen = explore ? ranked[deterministicIndex(seed, ranked.length)]! : ranked[0]!;

  return {
    prompt: buildPrompt(config, chosen.variant),
    variantId: chosen.variant.id,
    pillarId: chosen.variant.pillarId,
    sceneIndex: chosen.index,
    scene: chosen.variant.prompt,
    style: chosen.variant.style,
    shotType: chosen.variant.shotType,
    useCaseVertical: chosen.variant.useCaseVertical,
    productFocus: chosen.variant.productFocus,
    aesthetic: chosen.variant.aesthetic,
    selectionReason: explore
      ? "exploration selected an image variant to keep broad A/B testing alive"
      : chosen.overused
        ? `${chosen.variant.id} still scored highest after overuse penalty`
        : `${chosen.variant.id} is outperforming other image concepts`,
  };
}

export function buildCampaignImagePromptForAngle(angle: string, options: ImageSelectionOptions = {}): CampaignImagePromptDetails | null {
  const config = loadImagePrompts();
  if (!config) return null;
  return pickVariant(config, angle, options);
}

function getReferenceImagePath(filename?: string): string | null {
  const slug = process.env.CAMPAIGN?.trim();
  const trimmed = filename?.trim();
  if (!slug || !trimmed) return null;
  const refPath = resolve(CAMPAIGNS_DIR, slug, "reference-images", trimmed);
  return existsSync(refPath) ? refPath : null;
}

function extractB64FromResponse(result: { data?: Array<{ b64_json?: string; url?: string }> }): string | null {
  const first = result.data?.[0];
  if (!first) return null;
  if ("b64_json" in first && first.b64_json) return first.b64_json as string;
  return null;
}

function supportsImageEdit(model: string): boolean {
  return model === "dall-e-2";
}

export async function generateCampaignImage(
  angle: string,
  options: ImageSelectionOptions = {}
): Promise<{ buffer: Buffer | null; details: CampaignImagePromptDetails | null }> {
  if (!OPENAI_API_KEY) return { buffer: null, details: null };

  const config = loadImagePrompts();
  if (!config) return { buffer: null, details: null };

  const details = buildCampaignImagePromptForAngle(angle, options);
  if (!details) return { buffer: null, details: null };

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const size = (config.size as "1536x1024") || "1536x1024";
  const quality = (config.quality as "medium") || "medium";
  const variant = config.variants.find((entry) => entry.id === details.variantId);
  const refPath = getReferenceImagePath(variant?.referenceImage);

  if (refPath && supportsImageEdit(IMAGE_MODEL)) {
    try {
      const result = await client.images.edit({
        image: createReadStream(refPath) as unknown as File,
        prompt: `Place this canopy in the following scene. ${details.prompt}`,
        model: IMAGE_MODEL,
        n: 1,
        size,
      });
      const b64 = extractB64FromResponse(result);
      if (b64) return { buffer: Buffer.from(b64, "base64"), details };
    } catch (err) {
      console.warn("Campaign image edit (reference) failed, falling back to generate:", err);
    }
  }

  try {
    const result = await client.images.generate({
      model: IMAGE_MODEL,
      prompt: details.prompt,
      n: 1,
      size,
      quality,
    });
    const b64 = extractB64FromResponse(result);
    return { buffer: b64 ? Buffer.from(b64, "base64") : null, details };
  } catch (err) {
    console.warn("Campaign image generation failed:", err);
    return { buffer: null, details };
  }
}
