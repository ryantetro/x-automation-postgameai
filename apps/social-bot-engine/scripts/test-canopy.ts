/**
 * Canopy campaign regression tests (no network).
 * Verifies campaign bootstrap, pillar loading, angle rotation, prompt assembly, and image scene mapping.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

process.env.CAMPAIGN = "canopy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, "..");
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..", "..");

const { bootstrap } = await import("../src/bootstrap.js");
bootstrap();

const config = await import("../src/config.js");
const { loadPillarForAngle } = await import("../src/contentPillars.js");
const {
  buildAnglesOnlyPromptInput,
  getAnglesOnlyContextForDate,
  getAnglesOnlyPostFormatForDate,
  normalizeAnglesOnlyPostForLimit,
} = await import("../src/generatePost.js");
const { buildCampaignImagePromptForAngle } = await import("../src/generateImage.js");

type PillarsFile = {
  pillars: Array<{
    id: string;
    name: string;
    postIdeas: string[];
    targetAudiences: string[];
  }>;
};

const pillarsPath = resolve(WORKSPACE_ROOT, "campaigns", "canopy", "content-pillars.json");
const imagePromptsPath = resolve(WORKSPACE_ROOT, "campaigns", "canopy", "image-prompts.json");
const pillarsFile = JSON.parse(readFileSync(pillarsPath, "utf-8")) as PillarsFile;
const imagePrompts = JSON.parse(readFileSync(imagePromptsPath, "utf-8")) as {
  scenes: Array<{ scene: string; style: "mockup" | "lifestyle" }>;
};

let passed = 0;

function ok(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    throw error;
  }
}

console.log("--- canopy bootstrap/config ---");
ok("campaign bootstrap selects angles_only", () => {
  assert.equal(process.env.DATA_SOURCE, "angles_only");
  assert.equal(config.DATA_SOURCE, "angles_only");
});
ok("campaign bootstrap applies canopy brand", () => {
  assert.equal(config.BRAND_NAME, "Vicious Shade Supply Co.");
  assert.equal(config.BRAND_WEBSITE, "viciousshade.com");
  assert.equal(config.CLICK_TARGET_URL, "https://www.viciousshade.com");
});

console.log("\n--- canopy pillars/angles ---");
const expectedAngles = pillarsFile.pillars.map((pillar) => pillar.name);
ok("angles load from content-pillars.json in file order", () => {
  assert.deepEqual(config.getAnglesOnlyAngles(), expectedAngles);
});
ok("all 11 canopy pillars are unique", () => {
  assert.equal(new Set(expectedAngles).size, 11);
});
ok("11 consecutive dates cover all 11 canopy pillars", () => {
  const seen = new Set<string>();
  for (let day = 0; day < expectedAngles.length; day++) {
    const date = new Date(Date.UTC(2026, 0, day + 1, 12, 0, 0));
    seen.add(config.getAngleForDateAnglesOnly(date));
  }
  assert.deepEqual([...seen].sort(), [...expectedAngles].sort());
});
ok("each pillar returns 2-3 post ideas and a rotated target audience", () => {
  const sampleDate = new Date("2026-03-09T12:00:00Z");
  for (const pillar of pillarsFile.pillars) {
    const loaded = loadPillarForAngle(pillar.name, sampleDate);
    assert.ok(loaded, `missing pillar ${pillar.name}`);
    assert.ok(loaded.postIdeas.length >= 2 && loaded.postIdeas.length <= 3);
    assert.deepEqual(loaded.postIdeas, pillar.postIdeas.slice(0, 3));
    assert.ok(pillar.targetAudiences.includes(loaded.targetAudience));
  }
});

console.log("\n--- canopy prompt assembly ---");
const promptDate = "2026-03-09";
const promptAngle = "Photo Moment Marketing";
const promptInput = buildAnglesOnlyPromptInput({
  angle: promptAngle,
  date: promptDate,
  recentTweets: ["Most booths are invisible because they stay flat."],
  reserveChars: 25,
});
ok("angles_only prompt includes canopy-specific guidance", () => {
  assert.match(promptInput.system, /lead-gen/i);
  assert.match(promptInput.system, /Photo Moment Marketing/);
  assert.match(promptInput.system, /Local Business Marketing/);
});
ok("prompt input injects context, pillar ideas, audience, and seasonality instruction", () => {
  assert.equal(promptInput.context, getAnglesOnlyContextForDate(new Date("2026-03-09T12:00:00Z")));
  assert.equal(promptInput.format, getAnglesOnlyPostFormatForDate(new Date("2026-03-09T12:00:00Z")));
  assert.match(promptInput.userMessage, /Post ideas for this pillar/);
  assert.match(promptInput.userMessage, /Target audience today:/);
  assert.match(promptInput.userMessage, /If relevant, tie to seasonality or upcoming events\./);
  assert.match(promptInput.userMessage, /Do NOT repeat or closely mimic these recent posts:/);
  assert.ok(promptInput.maxBodyLength >= 180);
});
ok("angles_only normalization keeps branded posts within limit", () => {
  const long = "Setting up for a trade show in March means tackling common mistakes before they happen. Just saw a vendor roll in with a plain tablecloth completely forgettable. But with a full-color canopy and bold graphics, they could claim visibility from 50 feet away.";
  const normalized = normalizeAnglesOnlyPostForLimit(long, 280, "TENSION");
  assert.ok(normalized.length <= 280);
  assert.match(normalized, /Vicious Shade Supply Co\./);
  assert.match(normalized, /viciousshade\.com/);
});

console.log("\n--- canopy image mapping ---");
ok("image prompt file contains 11 scenes for 11 pillars", () => {
  assert.equal(imagePrompts.scenes.length, expectedAngles.length);
});
ok("each canopy pillar maps to the same-index image scene", () => {
  expectedAngles.forEach((angle, index) => {
    const details = buildCampaignImagePromptForAngle(angle);
    assert.ok(details, `no image prompt for ${angle}`);
    assert.equal(details.sceneIndex, index);
    assert.equal(details.scene, imagePrompts.scenes[index]?.scene);
    assert.equal(details.style, imagePrompts.scenes[index]?.style);
  });
});
ok("new community and nonprofit scenes are reachable", () => {
  const scenes = expectedAngles.map((angle) => buildCampaignImagePromptForAngle(angle)?.scene ?? "");
  assert.ok(scenes.some((scene) => /Local parade or community event/i.test(scene)));
  assert.ok(scenes.some((scene) => /Nonprofit or charity fundraiser booth/i.test(scene)));
});

console.log(`\n${passed} canopy checks passed`);
