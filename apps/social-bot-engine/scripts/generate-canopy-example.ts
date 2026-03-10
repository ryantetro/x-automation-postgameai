/**
 * Generate one full example canopy tweet (text + image) and save the image to a file.
 * Run: CAMPAIGN=canopy npx tsx apps/social-bot-engine/scripts/generate-canopy-example.ts
 * Requires OPENAI_API_KEY in env (e.g. from .env.local).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "../src/bootstrap.js";
bootstrap();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..", "..");

async function main(): Promise<void> {
  const { getAngleForDateAnglesOnly, CLICK_TARGET_URL, BRAND_WEBSITE } = await import("../src/config.js");
  const { generatePostAnglesOnly } = await import("../src/generatePost.js");
  const { generateCampaignImage } = await import("../src/generateImage.js");

  const today = new Date().toISOString().slice(0, 10);
  const angle = getAngleForDateAnglesOnly(new Date());
  let linkToAppend: string | null = CLICK_TARGET_URL || null;
  if (linkToAppend && BRAND_WEBSITE) {
    try {
      const website = BRAND_WEBSITE.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const host = new URL(linkToAppend).host.toLowerCase();
      if (host === website || host.endsWith(`.${website}`)) linkToAppend = null;
    } catch {
      // keep linkToAppend as-is
    }
  }
  const reserveChars = linkToAppend ? linkToAppend.length + 1 : 0;

  console.info("Generating tweet text...");
  const { text: rawText } = await generatePostAnglesOnly({
    angle,
    date: today,
    reserveChars,
  });
  const text = rawText ? (linkToAppend ? `${rawText.trim()} ${linkToAppend}`.trim() : rawText.trim()) : null;
  if (!text) {
    console.error("Failed to generate tweet text.");
    process.exit(1);
  }

  console.info("Generating image...");
  const imageBuffer = await generateCampaignImage(angle);
  if (!imageBuffer) {
    console.error("Failed to generate image.");
    process.exit(1);
  }

  const outDir = resolve(WORKSPACE_ROOT, "state", "canopy");
  mkdirSync(outDir, { recursive: true });
  const imagePath = resolve(outDir, "example-tweet.png");
  writeFileSync(imagePath, imageBuffer);

  console.info("\n--- Full example tweet ---\n");
  console.info(text);
  console.info("\n---");
  console.info("\nImage saved to:", imagePath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
