/**
 * Generate AI sample tweets for the Canopy campaign using the live angles_only path.
 * Usage:
 *   CAMPAIGN=canopy node --import tsx scripts/generate-canopy-sample-tweets.ts
 * Optional env:
 *   CANOPY_SAMPLES_PER_PILLAR=2
 *   CANOPY_INCLUDE_IMAGES=true
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "../src/bootstrap.js";

process.env.CAMPAIGN = process.env.CAMPAIGN?.trim() || "canopy";
bootstrap();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..", "..");

interface PillarRecord {
  id: string;
  name: string;
  postIdeas: string[];
  targetAudiences: string[];
}

interface PillarsFile {
  pillars: PillarRecord[];
}

interface SampleRecord {
  pillar: string;
  audience: string;
  date: string;
  text: string;
  length: number;
  imagePath?: string;
}

function getIntEnv(key: string, defaultValue: number): number {
  const raw = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

function boolEnv(key: string): boolean {
  const raw = (process.env[key] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getDateOffset(base: Date, offsetDays: number): string {
  const date = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function getLinkReserveChars(clickTargetUrl: string, brandWebsite: string): number {
  let linkToAppend: string | null = clickTargetUrl || null;
  if (linkToAppend && brandWebsite) {
    try {
      const website = brandWebsite.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const host = new URL(linkToAppend).host.toLowerCase();
      if (host === website || host.endsWith(`.${website}`)) linkToAppend = null;
    } catch {
      // keep linkToAppend as-is
    }
  }
  return linkToAppend ? linkToAppend.length + 1 : 0;
}

function loadPillars(): PillarRecord[] {
  const path = resolve(WORKSPACE_ROOT, "campaigns", "canopy", "content-pillars.json");
  const data = JSON.parse(readFileSync(path, "utf-8")) as PillarsFile;
  return data.pillars;
}

async function main(): Promise<void> {
  const { CLICK_TARGET_URL, BRAND_WEBSITE } = await import("../src/config.js");
  const { generatePostAnglesOnly } = await import("../src/generatePost.js");
  const { loadPillarForAngle } = await import("../src/contentPillars.js");
  const { isValidTweet } = await import("../src/validate.js");
  const { generateCampaignImage } = await import("../src/generateImage.js");

  const pillars = loadPillars();
  const perPillar = getIntEnv("CANOPY_SAMPLES_PER_PILLAR", 1);
  const includeImages = boolEnv("CANOPY_INCLUDE_IMAGES");
  const reserveChars = getLinkReserveChars(CLICK_TARGET_URL, BRAND_WEBSITE);
  const recentTweets: string[] = [];
  const samples: SampleRecord[] = [];
  const baseDate = new Date("2026-03-09T12:00:00Z");
  const outDir = resolve(WORKSPACE_ROOT, "state", "canopy");

  mkdirSync(outDir, { recursive: true });

  console.log(`Generating ${pillars.length * perPillar} canopy samples with AI...\n`);

  let offset = 0;
  for (const pillar of pillars) {
    for (let sampleIndex = 0; sampleIndex < perPillar; sampleIndex++) {
      const date = getDateOffset(baseDate, offset);
      const pillarData = loadPillarForAngle(pillar.name, new Date(`${date}T12:00:00Z`));
      let text = "";

      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await generatePostAnglesOnly({
          angle: pillar.name,
          date,
          reserveChars,
          recentTweets,
        });
        text = result.text?.trim() ?? "";
        if (isValidTweet(text, { requireBrand: false }) && !recentTweets.includes(text)) break;
        if (text) recentTweets.unshift(text);
        if (recentTweets.length > 25) recentTweets.length = 25;
      }

      if (!isValidTweet(text, { requireBrand: false })) {
        throw new Error(`Invalid generated tweet for pillar "${pillar.name}" on ${date}: ${text || "[empty]"}`);
      }

      let imagePath: string | undefined;
      if (includeImages) {
        const image = await generateCampaignImage(pillar.name);
        if (image.buffer) {
          imagePath = resolve(outDir, `sample-${String(samples.length + 1).padStart(2, "0")}.png`);
          writeFileSync(imagePath, image.buffer);
        }
      }

      recentTweets.unshift(text);
      if (recentTweets.length > 25) recentTweets.length = 25;

      samples.push({
        pillar: pillar.name,
        audience: pillarData?.targetAudience ?? pillar.targetAudiences[0] ?? "event planners and vendors",
        date,
        text,
        length: text.length,
        imagePath,
      });

      console.log(`${samples.length}. [${pillar.name}] (${text.length}/280)`);
      console.log(text);
      if (imagePath) console.log(`image: ${imagePath}`);
      console.log("");

      offset++;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = resolve(outDir, `sample-tweets-${stamp}.json`);
  const mdPath = resolve(outDir, `sample-tweets-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(samples, null, 2));
  writeFileSync(
    mdPath,
    [
      "# Canopy Sample Tweets",
      "",
      ...samples.flatMap((sample, index) => [
        `## ${index + 1}. ${sample.pillar}`,
        `- Date: ${sample.date}`,
        `- Audience: ${sample.audience}`,
        `- Length: ${sample.length}/280`,
        sample.imagePath ? `- Image: ${sample.imagePath}` : "- Image: none",
        "",
        sample.text,
        "",
      ]),
    ].join("\n")
  );

  console.log(`Saved JSON: ${jsonPath}`);
  console.log(`Saved Markdown: ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
