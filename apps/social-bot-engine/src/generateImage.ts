/**
 * AI-generated images for campaigns with imageEnabled=true.
 * Loads scene prompts from campaigns/<slug>/image-prompts.json.
 * Optional: referenceImage sends a reference photo to the Edit API for scene placement.
 * See campaigns/canopy/image-prompts.json for the schema.
 */
import { readFileSync, existsSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import { OPENAI_API_KEY, IMAGE_MODEL, CAMPAIGNS_DIR, getAnglesOnlyAngles } from "./config.js";

interface ImagePromptsConfig {
  mockupSuffix: string;
  lifestyleSuffix: string;
  /** Optional anti-AI line appended to every prompt (e.g. "No illustration, no 3D render..."). */
  negativePrompt?: string;
  scenes: { scene: string; style: "mockup" | "lifestyle" }[];
  /** Optional reference image filename in campaigns/<slug>/reference-images/ for Edit API. */
  referenceImage?: string;
  size?: string;
  quality?: string;
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

function getScenePromptForAngle(config: ImagePromptsConfig, angle: string): string {
  const angles = getAnglesOnlyAngles();
  const index = angles.findIndex((a) => a === angle);
  const sceneIndex = index >= 0 ? index % config.scenes.length : 0;
  const entry = config.scenes[sceneIndex] ?? config.scenes[0];
  const suffix = entry.style === "mockup" ? config.mockupSuffix : config.lifestyleSuffix;
  let prompt = `${entry.scene}. ${suffix}`;
  if (config.negativePrompt?.trim()) {
    prompt += config.negativePrompt.trim();
  }
  return prompt;
}

export interface CampaignImagePromptDetails {
  prompt: string;
  sceneIndex: number;
  scene: string;
  style: "mockup" | "lifestyle";
}

export function buildCampaignImagePromptForAngle(angle: string): CampaignImagePromptDetails | null {
  const config = loadImagePrompts();
  if (!config || config.scenes.length === 0) return null;
  const angles = getAnglesOnlyAngles();
  const index = angles.findIndex((a) => a === angle);
  const sceneIndex = index >= 0 ? index % config.scenes.length : 0;
  const entry = config.scenes[sceneIndex] ?? config.scenes[0];
  return {
    prompt: getScenePromptForAngle(config, angle),
    sceneIndex,
    scene: entry.scene,
    style: entry.style,
  };
}

function getReferenceImagePath(config: ImagePromptsConfig): string | null {
  const slug = process.env.CAMPAIGN?.trim();
  const filename = config.referenceImage?.trim();
  if (!slug || !filename) return null;
  const refPath = resolve(CAMPAIGNS_DIR, slug, "reference-images", filename);
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

/**
 * Generate a single campaign image for the given content angle.
 * If referenceImage is set in config and the file exists, uses the Edit API (reference + prompt); otherwise uses Generate API (prompt only).
 * Returns PNG as Buffer, or null if generation fails or no image-prompts.json exists.
 */
export async function generateCampaignImage(angle: string): Promise<Buffer | null> {
  if (!OPENAI_API_KEY) return null;

  const config = loadImagePrompts();
  if (!config) return null;

  const promptDetails = buildCampaignImagePromptForAngle(angle);
  if (!promptDetails) return null;
  const prompt = promptDetails.prompt;
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const size = (config.size as "1536x1024") || "1536x1024";
  const quality = (config.quality as "medium") || "medium";

  const refPath = getReferenceImagePath(config);

  if (refPath && supportsImageEdit(IMAGE_MODEL)) {
    try {
      const result = await client.images.edit({
        image: createReadStream(refPath) as unknown as File,
        prompt: `Place this canopy in the following scene. ${prompt}`,
        model: IMAGE_MODEL,
        n: 1,
        size: size as "1536x1024",
      });
      const b64 = extractB64FromResponse(result);
      if (b64) return Buffer.from(b64, "base64");
    } catch (err) {
      console.warn("Campaign image edit (reference) failed, falling back to generate:", err);
    }
  }

  try {
    const result = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      n: 1,
      size,
      quality,
    });
    const b64 = extractB64FromResponse(result);
    if (!b64) return null;
    return Buffer.from(b64, "base64");
  } catch (err) {
    console.warn("Campaign image generation failed:", err);
    return null;
  }
}
