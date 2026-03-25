import type { Persona } from "./personaEngine.js";
import type { ContentTypeId } from "./contentTypeTemplates.js";
import { CONTENT_TYPE_DEFS } from "./contentTypeTemplates.js";
import type { TweetAnalyticsRecord } from "./analytics.js";
import type { PostTarget } from "./config.js";

// ── Brand Mix ──

export interface BrandMixDecision {
  brandMentionAllowed: boolean;
  reason: string;
}

export function enforceBrandMix(
  persona: Persona,
  recentPosted: TweetAnalyticsRecord[]
): BrandMixDecision {
  if (persona.brandMentionPolicy === "never") {
    return { brandMentionAllowed: false, reason: "persona policy: never" };
  }

  // Check last 10 posted tweets
  const recent10 = recentPosted
    .filter((t) => t.status === "posted")
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, 10);

  const brandCount = recent10.filter(
    (t) => t.brandMentioned === true || t.brandTagIncluded === true
  ).length;

  if (brandCount >= 2) {
    return {
      brandMentionAllowed: false,
      reason: `80/20 enforcement: ${brandCount}/10 recent posts had brand (max 2)`,
    };
  }

  // "sometimes" policy: 50% chance
  const allowed = Math.random() < 0.5;
  return {
    brandMentionAllowed: allowed,
    reason: allowed
      ? "persona policy: sometimes (coin flip: yes)"
      : "persona policy: sometimes (coin flip: no)",
  };
}

// ── Content Type Selection ──

export interface ContentTypeSelection {
  contentType: ContentTypeId;
  reason: string;
}

export function selectContentType(
  persona: Persona,
  targetPlatforms: PostTarget[],
  recentPosted: TweetAnalyticsRecord[]
): ContentTypeSelection {
  // Filter persona content types to valid ones
  let candidates = persona.contentTypes.filter(
    (ct): ct is ContentTypeId => ct in CONTENT_TYPE_DEFS
  );

  if (candidates.length === 0) {
    return { contentType: "observation", reason: "fallback: no valid content types on persona" };
  }

  // Filter by platform compatibility
  const hasBothOrXOnly = targetPlatforms.includes("x");
  if (hasBothOrXOnly) {
    // When posting to X (even dual-platform), exclude threads-only types
    candidates = candidates.filter(
      (ct) => CONTENT_TYPE_DEFS[ct].platformRestriction !== "threads_only"
    );
  }

  if (candidates.length === 0) {
    return { contentType: "observation", reason: "fallback: no platform-compatible types" };
  }

  // Check recent history: avoid 3x repeat
  const recent5 = recentPosted
    .filter((t) => t.status === "posted" && t.contentType)
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, 5);

  const lastTypes = recent5.slice(0, 2).map((t) => t.contentType);
  if (
    lastTypes.length >= 2 &&
    lastTypes[0] === lastTypes[1] &&
    candidates.length > 1
  ) {
    const repeatedType = lastTypes[0];
    candidates = candidates.filter((ct) => ct !== repeatedType);
  }

  // Enforce community_question cap: max 1 in last 5
  const recentQuestions = recent5.filter(
    (t) => t.contentType === "community_question"
  ).length;
  if (recentQuestions >= 1) {
    candidates = candidates.filter((ct) => ct !== "community_question");
  }

  if (candidates.length === 0) {
    return { contentType: "observation", reason: "fallback: all types filtered out" };
  }

  // Equal weight random selection
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return { contentType: selected, reason: `selected from ${candidates.length} candidates` };
}
