import type { AnalyticsStore, TweetAnalyticsRecord } from "./analytics.js";
import type { WeightAdjustment } from "./personaEngine.js";

// ── Constants ──

const WINDOW_DAYS = 45;
const MIN_POSTS_FOR_LESSON = 10;
const MIN_PERSONA_SAMPLE = 3;
const MAX_WEIGHT_ADJUSTMENT = 0.05;

// ── Hybrid Score (canonical formula — matches canopyAgent.ts) ──

function hybridScore(record: TweetAnalyticsRecord): number {
  const m = record.metrics;
  if (!m) return 0;
  const impressions = m.impressionCount ?? 0;
  const likes = m.likeCount ?? 0;
  const replies = m.replyCount ?? 0;
  const reposts = m.retweetCount ?? 0;
  const quotes = m.quoteCount ?? 0;
  const bookmarks = m.bookmarkCount ?? 0;
  return impressions + likes * 8 + replies * 16 + reposts * 14 + quotes * 12 + bookmarks * 10;
}

// ── Lesson Generation ──

export interface LessonResult {
  lessonText: string;
  weightAdjustments: WeightAdjustment[];
  lessonVersion: string;
  isColdStart: boolean;
}

export function generateLesson(
  campaignSlug: string,
  store: AnalyticsStore,
  currentWeights: Map<string, number>
): LessonResult {
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const lessonVersion = `lesson-${new Date().toISOString().slice(0, 10)}`;

  const eligible = store.tweets.filter(
    (t) =>
      t.status === "posted" &&
      t.metrics &&
      typeof t.metrics.impressionCount === "number" &&
      Date.parse(t.postedAt) >= cutoff &&
      (!campaignSlug || !t.sport || t.sport === campaignSlug)
  );

  // Cold start
  if (eligible.length < MIN_POSTS_FOR_LESSON) {
    return {
      lessonText: [
        "LESSON: COLD START (fewer than 10 posts with metrics).",
        "Focus on variety. Test all personas equally.",
        "Prioritize posts that would earn a follow even with zero product mention.",
        `Posts analyzed: ${eligible.length}/${MIN_POSTS_FOR_LESSON} needed.`,
      ].join("\n"),
      weightAdjustments: [],
      lessonVersion,
      isColdStart: true,
    };
  }

  // Score all posts
  const scored = eligible
    .map((t) => ({ record: t, score: hybridScore(t) }))
    .sort((a, b) => b.score - a.score);

  const top5 = scored.slice(0, 5);
  const bottom5 = scored.slice(-5);
  const avgScore = scored.reduce((s, t) => s + t.score, 0) / scored.length;

  // Per-persona stats
  const personaStats = new Map<
    string,
    { count: number; totalScore: number; avgScore: number }
  >();
  for (const { record, score } of scored) {
    const pid = record.personaId ?? "unknown";
    const existing = personaStats.get(pid) ?? { count: 0, totalScore: 0, avgScore: 0 };
    existing.count++;
    existing.totalScore += score;
    personaStats.set(pid, existing);
  }
  for (const [, stats] of personaStats) {
    stats.avgScore = stats.totalScore / stats.count;
  }

  // Per-content-type stats
  const typeStats = new Map<string, { count: number; totalScore: number; avgScore: number }>();
  for (const { record, score } of scored) {
    const ct = record.contentType ?? "unknown";
    const existing = typeStats.get(ct) ?? { count: 0, totalScore: 0, avgScore: 0 };
    existing.count++;
    existing.totalScore += score;
    typeStats.set(ct, existing);
  }
  for (const [, stats] of typeStats) {
    stats.avgScore = stats.totalScore / stats.count;
  }

  // Brand vs no-brand
  const brandPosts = scored.filter(
    (s) => s.record.brandMentioned === true || s.record.brandTagIncluded === true
  );
  const noBrandPosts = scored.filter(
    (s) => !(s.record.brandMentioned === true || s.record.brandTagIncluded === true)
  );
  const brandAvg =
    brandPosts.length > 0
      ? brandPosts.reduce((s, t) => s + t.score, 0) / brandPosts.length
      : 0;
  const noBrandAvg =
    noBrandPosts.length > 0
      ? noBrandPosts.reduce((s, t) => s + t.score, 0) / noBrandPosts.length
      : 0;
  const brandRatio = noBrandAvg > 0 && brandAvg > 0 ? (noBrandAvg / brandAvg).toFixed(1) : "n/a";

  // Best/worst persona
  const personaEntries = [...personaStats.entries()]
    .filter(([pid]) => pid !== "unknown")
    .sort((a, b) => b[1].avgScore - a[1].avgScore);
  const bestPersona = personaEntries[0];
  const worstPersona = personaEntries[personaEntries.length - 1];

  // Best content type
  const typeEntries = [...typeStats.entries()]
    .filter(([ct]) => ct !== "unknown")
    .sort((a, b) => b[1].avgScore - a[1].avgScore);
  const bestType = typeEntries[0];

  // Weight adjustments
  const weightAdjustments: WeightAdjustment[] = [];
  if (personaEntries.length >= 2) {
    for (const [pid, stats] of personaEntries) {
      if (stats.count < MIN_PERSONA_SAMPLE) continue;
      const currentWeight = currentWeights.get(pid);
      if (currentWeight === undefined) continue;

      const scoreDelta = stats.avgScore - avgScore;
      // Scale adjustment: positive delta -> increase, negative -> decrease
      const rawAdj = Math.sign(scoreDelta) * Math.min(MAX_WEIGHT_ADJUSTMENT, Math.abs(scoreDelta) / avgScore * 0.1);
      const newWeight = Math.max(0.05, Math.min(0.40, currentWeight + rawAdj));

      if (Math.abs(newWeight - currentWeight) > 0.001) {
        weightAdjustments.push({
          personaId: pid,
          oldWeight: currentWeight,
          newWeight: Number(newWeight.toFixed(4)),
        });
      }
    }
  }

  // Build lesson text
  const lines: string[] = [
    `LESSON FROM LAST ${WINDOW_DAYS} DAYS (${eligible.length} posts analyzed):`,
  ];
  if (bestPersona) {
    lines.push(
      `- Best performing persona: ${bestPersona[0]} (avg score: ${bestPersona[1].avgScore.toFixed(1)}, ${bestPersona[1].count} posts)`
    );
  }
  if (worstPersona && worstPersona[0] !== bestPersona?.[0]) {
    lines.push(
      `- Worst performing persona: ${worstPersona[0]} (avg score: ${worstPersona[1].avgScore.toFixed(1)}, ${worstPersona[1].count} posts)`
    );
  }
  if (bestType) {
    lines.push(
      `- Best content type: ${bestType[0]} (avg score: ${bestType[1].avgScore.toFixed(1)})`
    );
  }
  if (brandRatio !== "n/a") {
    lines.push(
      `- Posts without brand mention averaged ${brandRatio}x vs posts with brand`
    );
  }
  if (top5.length > 0) {
    lines.push(
      `- Top post: "${top5[0].record.text.slice(0, 100)}..." (score: ${top5[0].score}, persona: ${top5[0].record.personaId ?? "unknown"})`
    );
  }
  if (bottom5.length > 0) {
    const worst = bottom5[bottom5.length - 1];
    lines.push(
      `- Avoid posts like: "${worst.record.text.slice(0, 80)}..." (score: ${worst.score})`
    );
  }
  if (weightAdjustments.length > 0) {
    lines.push("", "WEIGHT ADJUSTMENTS:");
    for (const adj of weightAdjustments) {
      const direction = adj.newWeight > adj.oldWeight ? "Increase" : "Decrease";
      lines.push(
        `- ${direction} ${adj.personaId} from ${(adj.oldWeight * 100).toFixed(0)}% to ${(adj.newWeight * 100).toFixed(0)}%`
      );
    }
  }

  return {
    lessonText: lines.join("\n"),
    weightAdjustments,
    lessonVersion,
    isColdStart: false,
  };
}
