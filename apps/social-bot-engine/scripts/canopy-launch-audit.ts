import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "../src/bootstrap.js";

process.env.CAMPAIGN = process.env.CAMPAIGN?.trim() || "canopy";
bootstrap();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..", "..");

type SeriesId =
  | "vendor_life"
  | "booth_hot_take"
  | "booth_identity"
  | "proof_in_the_wild"
  | "utah_event_radar";

interface AuditRecord {
  index: number;
  date: string;
  angle: string;
  seriesId: SeriesId;
  contentBucket: "culture" | "education" | "community" | "promo";
  brandTagPolicy: "none" | "optional" | "soft_commercial";
  brandTagIncluded: boolean;
  imageEnabled: boolean;
  imageReason: string;
  candidateScore: number;
  text: string;
}

function getIntEnv(key: string, defaultValue: number): number {
  const raw = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultValue;
}

function getDateOffset(base: Date, offsetDays: number): string {
  const date = new Date(base.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function readRecentTweetTexts(store: { tweets: Array<{ status: string; text: string; postedAt: string }> }, cap: number): string[] {
  return store.tweets
    .filter((tweet) => tweet.status === "posted" && !!tweet.text)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, cap)
    .map((tweet) => tweet.text);
}

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

async function main(): Promise<void> {
  const sampleCount = getIntEnv("CANOPY_AUDIT_POSTS", 20);
  const candidateCount = getIntEnv("CANOPY_AUDIT_CANDIDATES", 5);
  const finalistCount = Math.max(2, Math.min(candidateCount, getIntEnv("CANOPY_AUDIT_FINALISTS", 3)));
  const reserveChars = 0;
  const outDir = resolve(WORKSPACE_ROOT, "state", "canopy");

  const {
    loadAnalyticsStore,
    ANALYTICS_STORE_FILE,
  } = await import("../src/analytics.js");
  const {
    chooseCanopyAgentStrategy,
    chooseCanopyImagePlan,
    rankCanopyCandidates,
  } = await import("../src/canopyAgent.js");
  const {
    generateCanopyCandidateBatch,
    judgeCanopyCandidates,
  } = await import("../src/generatePost.js");
  const { isValidTweet } = await import("../src/validate.js");

  const analyticsStore = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  const today = new Date();
  const recentTexts = readRecentTweetTexts(analyticsStore, 60);
  const auditRecords: AuditRecord[] = [];

  console.log(`Generating ${sampleCount} canopy launch-audit samples...\n`);

  for (let index = 0; index < sampleCount; index++) {
    const date = getDateOffset(today, index);
    const strategy = chooseCanopyAgentStrategy(analyticsStore, new Date(`${date}T12:00:00Z`));
    const imagePlan = chooseCanopyImagePlan(analyticsStore, strategy, new Date(`${date}T12:00:00Z`));
    const rawCandidates = await generateCanopyCandidateBatch({
      angle: strategy.angle,
      date,
      reserveChars,
      recentTweets: [...recentTexts, ...auditRecords.map((record) => record.text)].slice(0, 25),
      strategy,
      count: candidateCount,
    });
    const ranked = rankCanopyCandidates(rawCandidates, strategy);
    const finalists = ranked.slice(0, finalistCount);
    const judged = await judgeCanopyCandidates(strategy, finalists);
    const judgedMap = new Map(judged.map((row) => [row.candidateId, row.judgeScore]));
    const finalRanked = ranked
      .map((row) => ({
        ...row,
        judgeScore: judgedMap.get(row.candidateId) ?? 0,
        totalScore: row.totalScore + (judgedMap.get(row.candidateId) ?? 0) * 0.6,
      }))
      .sort((a, b) => b.totalScore - a.totalScore || a.rank - b.rank);
    const selected = finalRanked.find((row) => isValidTweet(row.text, { requireBrand: false })) ?? finalRanked[0];
    if (!selected) continue;
    auditRecords.push({
      index: index + 1,
      date,
      angle: strategy.angle,
      seriesId: strategy.seriesId,
      contentBucket: strategy.contentBucket,
      brandTagPolicy: strategy.brandTagPolicy,
      brandTagIncluded: selected.text.includes("Vicious Shade Supply Co.") || selected.text.includes("viciousshade.com"),
      imageEnabled: imagePlan.enabled,
      imageReason: imagePlan.reason,
      candidateScore: Number(selected.totalScore.toFixed(2)),
      text: selected.text,
    });
    console.log(`${index + 1}. [${strategy.seriesId}] [${strategy.contentBucket}] score=${selected.totalScore.toFixed(1)} image=${imagePlan.enabled ? "on" : "off"}`);
    console.log(selected.text);
    console.log("");
  }

  const seriesCounts = countBy(auditRecords.map((record) => record.seriesId));
  const bucketCounts = countBy(auditRecords.map((record) => record.contentBucket));
  const brandTagCount = auditRecords.filter((record) => record.brandTagIncluded).length;
  const imageOnCount = auditRecords.filter((record) => record.imageEnabled).length;
  const warnings: string[] = [];

  if (brandTagCount > Math.floor(auditRecords.length * 0.4)) {
    warnings.push(`Brand tag showed up ${brandTagCount}/${auditRecords.length} times, which is above the launch cap.`);
  }
  if ((seriesCounts.utah_event_radar ?? 0) > Math.ceil(auditRecords.length * 0.15)) {
    warnings.push(`Utah Event Radar appeared ${seriesCounts.utah_event_radar}/${auditRecords.length} times. That is too frequent before event-feed automation exists.`);
  }
  if ((seriesCounts.vendor_life ?? 0) < 2) {
    warnings.push("Vendor Life is underrepresented. The feed risks losing its lived-in vendor personality.");
  }
  if (auditRecords.some((record) => record.candidateScore < 75)) {
    warnings.push("At least one selected draft scored below the quality floor of 75. Review weak outputs before launch.");
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = resolve(outDir, `launch-audit-${stamp}.json`);
  const mdPath = resolve(outDir, `launch-audit-${stamp}.md`);

  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sampleCount: auditRecords.length,
        seriesCounts,
        bucketCounts,
        brandTagCount,
        imageOnCount,
        warnings,
        records: auditRecords,
      },
      null,
      2
    )
  );

  writeFileSync(
    mdPath,
    [
      "# Canopy Launch Audit",
      "",
      `- Generated at: ${new Date().toISOString()}`,
      `- Samples: ${auditRecords.length}`,
      `- Brand tag count: ${brandTagCount}/${auditRecords.length}`,
      `- Image enabled count: ${imageOnCount}/${auditRecords.length}`,
      `- Series mix: ${Object.entries(seriesCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
      `- Bucket mix: ${Object.entries(bucketCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
      "",
      "## Warnings",
      ...(warnings.length > 0 ? warnings.map((warning) => `- ${warning}`) : ["- No launch warnings triggered."]),
      "",
      "## Samples",
      ...auditRecords.flatMap((record) => [
        `### ${record.index}. ${record.seriesId} / ${record.contentBucket}`,
        `- Date: ${record.date}`,
        `- Angle: ${record.angle}`,
        `- Brand tag policy: ${record.brandTagPolicy}`,
        `- Brand tag included: ${record.brandTagIncluded ? "yes" : "no"}`,
        `- Image enabled: ${record.imageEnabled ? "yes" : "no"}`,
        `- Candidate score: ${record.candidateScore}`,
        `- Image reason: ${record.imageReason}`,
        "",
        record.text,
        "",
      ]),
    ].join("\n")
  );

  console.log(`Saved JSON: ${jsonPath}`);
  console.log(`Saved Markdown: ${mdPath}`);
  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
