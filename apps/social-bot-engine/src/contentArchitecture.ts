import type { NewsArticle } from "./fetchNews.js";

export type ContentFrameId =
  | "forty_eight_hour_window"
  | "film_room_truth"
  | "development_gap"
  | "moment_nobody_captures"
  | "scoreboard_lie"
  | "conversation_that_doesnt_happen";

export type HookStructureId =
  | "specific_number"
  | "contradiction"
  | "scene_setter"
  | "universal_truth"
  | "insider_divide"
  | "named_moment";

export type EmotionTarget =
  | "recognition"
  | "frustration"
  | "validation"
  | "insider_pride"
  | "loss"
  | "urgency"
  | "provocation"
  | "vulnerability";

export type NewsMomentType =
  | "upset"
  | "star_underperformance"
  | "coaching_change"
  | "halftime_comeback"
  | "season_review"
  | "viral_film_breakdown"
  | "unknown";

export interface ContentFrameDefinition {
  id: ContentFrameId;
  label: string;
  territory: string;
  emotionalTarget: EmotionTarget;
  bestPlatform: "x" | "threads" | "both";
  allowedHooks: HookStructureId[];
  avoidRules: string[];
  instructionBlock: string;
  newsPriority: NewsMomentType[];
}

export interface HookStructureDefinition {
  id: HookStructureId;
  label: string;
  description: string;
  openingGuidance: string;
}

export interface ContentDecision {
  frameId: ContentFrameId;
  frameLabel: string;
  hookStructureId: HookStructureId;
  hookStructureLabel: string;
  emotionTarget: EmotionTarget;
  frameReason: string;
  newsMomentType: NewsMomentType;
  openingPattern: string;
}

export interface RecentContentDecision {
  frameId?: ContentFrameId;
  hookStructureId?: HookStructureId;
  openingPattern?: string;
  postedAt: string;
}

export interface SelectContentDecisionInput {
  sport: string;
  date: string;
  targetPlatforms: Array<"x" | "threads">;
  newsArticle?: NewsArticle;
  newsUsed?: boolean;
  recentDecisions?: RecentContentDecision[];
}

export const FRAME_DEFINITIONS: Record<ContentFrameId, ContentFrameDefinition> = {
  forty_eight_hour_window: {
    id: "forty_eight_hour_window",
    label: "The 48-Hour Window",
    territory: "The coaching intel that exists right after the game and decays by the next practice cycle.",
    emotionalTarget: "urgency",
    bestPlatform: "x",
    allowedHooks: ["specific_number", "contradiction", "scene_setter"],
    avoidRules: ["Do not mention note-taking or tell coaches how to fix the problem."],
    instructionBlock:
      "Context is The 48-Hour Window frame. Write about the specific time window between the final whistle and the next practice when real coaching intel exists and then disappears. Make the reader feel the loss of that window. Describe the situation only.",
    newsPriority: ["season_review", "unknown"],
  },
  film_room_truth: {
    id: "film_room_truth",
    label: "The Film Room Truth",
    territory: "The gap between watching film and actually extracting development signal from it.",
    emotionalTarget: "provocation",
    bestPlatform: "threads",
    allowedHooks: ["contradiction", "insider_divide", "universal_truth"],
    avoidRules: ["Do not lecture about how to watch film."],
    instructionBlock:
      "Context is The Film Room Truth frame. Write about the gap between watching film and actually extracting development signal from it. Surface an uncomfortable truth that coaches recognize but rarely say out loud. Do not offer a solution.",
    newsPriority: ["viral_film_breakdown", "unknown"],
  },
  development_gap: {
    id: "development_gap",
    label: "The Development Gap",
    territory: "The gap between talent and execution that coaches feel but rarely explain cleanly.",
    emotionalTarget: "frustration",
    bestPlatform: "both",
    allowedHooks: ["universal_truth", "scene_setter", "specific_number"],
    avoidRules: ["Do not use generic player development slogans."],
    instructionBlock:
      "Context is The Development Gap frame. Write about the specific unnamed space between a player's talent and their execution. Make coaches recognize a player, a season, or a recurring frustration in what you describe. Do not prescribe a fix.",
    newsPriority: ["star_underperformance", "unknown"],
  },
  moment_nobody_captures: {
    id: "moment_nobody_captures",
    label: "The Moment Nobody Captures",
    territory: "Specific in-game moments that contain the real coaching intel and disappear by Monday.",
    emotionalTarget: "loss",
    bestPlatform: "x",
    allowedHooks: ["named_moment", "scene_setter", "specific_number"],
    avoidRules: ["Be specific about the moment; do not generalize into advice."],
    instructionBlock:
      "Context is The Moment Nobody Captures frame. Write about a specific in-game situation, adjustment, timeout, or possession that held real coaching intel and disappeared before anyone captured it. This frame should feel immediate and scene-based.",
    newsPriority: ["halftime_comeback", "unknown"],
  },
  scoreboard_lie: {
    id: "scoreboard_lie",
    label: "The Scoreboard Lie",
    territory: "The gap between what the box score says and what coaches actually see.",
    emotionalTarget: "insider_pride",
    bestPlatform: "threads",
    allowedHooks: ["contradiction", "insider_divide", "named_moment"],
    avoidRules: ["Do not condescend to fans or explain what coaches should do."],
    instructionBlock:
      "Context is The Scoreboard Lie frame. Write about the gap between the public narrative and what coaches actually see. Make coaches feel seen as insiders with knowledge fans do not have. Do not turn it into advice.",
    newsPriority: ["upset", "unknown"],
  },
  conversation_that_doesnt_happen: {
    id: "conversation_that_doesnt_happen",
    label: "The Conversation That Doesn't Happen",
    territory: "The gap between what coaches mean to say right after games and what actually gets said.",
    emotionalTarget: "vulnerability",
    bestPlatform: "threads",
    allowedHooks: ["scene_setter", "named_moment", "universal_truth"],
    avoidRules: ["Do not tell coaches to communicate better or mention feedback."],
    instructionBlock:
      "Context is The Conversation That Doesn't Happen frame. Write about the gap between the coaching insight that exists right after a game and what actually gets communicated to players. Be specific, human, and non-preachy.",
    newsPriority: ["coaching_change", "unknown"],
  },
};

export const HOOK_DEFINITIONS: Record<HookStructureId, HookStructureDefinition> = {
  specific_number: {
    id: "specific_number",
    label: "Specific Number",
    description: "Lead with a number and what it means in coaching reality.",
    openingGuidance: "Open with a number and the coaching meaning behind it in the first 8 words.",
  },
  contradiction: {
    id: "contradiction",
    label: "Contradiction",
    description: "Lead with a reversal or tension between what looks true and what is true.",
    openingGuidance: "Open with a contradiction, reversal, or public/private tension.",
  },
  scene_setter: {
    id: "scene_setter",
    label: "Scene-Setter",
    description: "Start in a concrete time, place, or coach-recognizable situation.",
    openingGuidance: "Open by dropping the reader into a specific day, time, or coaching scene.",
  },
  universal_truth: {
    id: "universal_truth",
    label: "Universal Truth",
    description: "Start with a pattern every coach recognizes.",
    openingGuidance: "Open with a universal pattern or coach-recognizable truth, not advice.",
  },
  insider_divide: {
    id: "insider_divide",
    label: "Insider Divide",
    description: "Contrast what outsiders see with what coaches actually see.",
    openingGuidance: "Open with the gap between fans/public narrative and coaching reality.",
  },
  named_moment: {
    id: "named_moment",
    label: "Named Moment",
    description: "Lead with a specific timeout, halftime, rep, or moment.",
    openingGuidance: "Open by naming the specific moment that carried the real coaching intel.",
  },
};

const DEFAULT_FRAME_ORDER: ContentFrameId[] = [
  "development_gap",
  "film_room_truth",
  "scoreboard_lie",
  "forty_eight_hour_window",
  "moment_nobody_captures",
  "conversation_that_doesnt_happen",
];

const NEWS_FRAME_BY_MOMENT: Record<NewsMomentType, ContentFrameId> = {
  upset: "scoreboard_lie",
  star_underperformance: "development_gap",
  coaching_change: "conversation_that_doesnt_happen",
  halftime_comeback: "moment_nobody_captures",
  season_review: "forty_eight_hour_window",
  viral_film_breakdown: "film_room_truth",
  unknown: "moment_nobody_captures",
};

function firstWordsPattern(text: string | undefined): string {
  if (!text) return "";
  return text.trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
}

export function classifyNewsMoment(article: NewsArticle | undefined): NewsMomentType {
  if (!article) return "unknown";
  const text = `${article.title} ${article.description ?? ""}`.toLowerCase();
  if (/(upset|stun|shocks?|surprise|blown away)/.test(text)) return "upset";
  if (/(underperform|struggle|cold|slump|injury|thumb|hamstring|wrist|questionable|out)/.test(text)) {
    return "star_underperformance";
  }
  if (/(coach|firing|fired|dismissed|extension|hired|manager change)/.test(text)) return "coaching_change";
  if (/(halftime|comeback|rallies|second-half|second half|fourth quarter swing)/.test(text)) {
    return "halftime_comeback";
  }
  if (/(season review|season recap|end of season|postmortem|exit interview|wrap-up)/.test(text)) {
    return "season_review";
  }
  if (/(film|breakdown|all-22|all 22|tape|clip went viral|viral clip)/.test(text)) return "viral_film_breakdown";
  return "unknown";
}

function pickFrame(
  newsMomentType: NewsMomentType,
  recentDecisions: RecentContentDecision[],
  targetPlatforms: Array<"x" | "threads">
): ContentFrameId {
  if (newsMomentType !== "unknown") return NEWS_FRAME_BY_MOMENT[newsMomentType];

  const preferredPlatform = targetPlatforms.includes("threads") && !targetPlatforms.includes("x") ? "threads" : "x";
  const counts = new Map<ContentFrameId, number>();
  for (const recent of recentDecisions) {
    if (!recent.frameId) continue;
    counts.set(recent.frameId, (counts.get(recent.frameId) ?? 0) + 1);
  }

  const candidates = DEFAULT_FRAME_ORDER
    .filter((frameId) => {
      const frame = FRAME_DEFINITIONS[frameId];
      return frame.bestPlatform === "both" || frame.bestPlatform === preferredPlatform;
    })
    .sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));

  return candidates[0] ?? "development_gap";
}

function pickHook(frameId: ContentFrameId, recentDecisions: RecentContentDecision[]): HookStructureId {
  const allowed = FRAME_DEFINITIONS[frameId].allowedHooks;
  const recentHooks = new Map<HookStructureId, number>();
  let mostTeamsUses = 0;
  for (const recent of recentDecisions.slice(0, 10)) {
    if (recent.hookStructureId) recentHooks.set(recent.hookStructureId, (recentHooks.get(recent.hookStructureId) ?? 0) + 1);
    if (recent.openingPattern === "most_teams") mostTeamsUses += 1;
  }

  const sorted = [...allowed].sort((a, b) => (recentHooks.get(a) ?? 0) - (recentHooks.get(b) ?? 0));
  const selected = sorted[0] ?? allowed[0];
  if (selected === "universal_truth" && mostTeamsUses > 0) {
    return sorted.find((hook) => hook !== "universal_truth") ?? selected;
  }
  return selected;
}

function inferOpeningPatternForHook(hookId: HookStructureId): string {
  if (hookId === "specific_number") return "specific_number";
  if (hookId === "contradiction") return "contradiction";
  if (hookId === "scene_setter") return "scene_setter";
  if (hookId === "insider_divide") return "insider_divide";
  if (hookId === "named_moment") return "named_moment";
  return "universal_truth";
}

export function selectContentDecision(input: SelectContentDecisionInput): ContentDecision {
  const recentDecisions = input.recentDecisions ?? [];
  const newsMomentType = input.newsUsed ? classifyNewsMoment(input.newsArticle) : "unknown";
  const frameId = pickFrame(newsMomentType, recentDecisions, input.targetPlatforms);
  const hookStructureId = pickHook(frameId, recentDecisions);
  const frame = FRAME_DEFINITIONS[frameId];
  const hook = HOOK_DEFINITIONS[hookStructureId];
  const frameReason =
    newsMomentType !== "unknown"
      ? `Mapped news moment ${newsMomentType} to ${frame.label}.`
      : `Selected ${frame.label} to diversify recent frame usage and fit ${frame.bestPlatform}.`;

  return {
    frameId,
    frameLabel: frame.label,
    hookStructureId,
    hookStructureLabel: hook.label,
    emotionTarget: frame.emotionalTarget,
    frameReason,
    newsMomentType,
    openingPattern: inferOpeningPatternForHook(hookStructureId),
  };
}

export function buildRecentContentDecision(input: {
  frameId?: ContentFrameId;
  hookStructureId?: HookStructureId;
  openingPattern?: string;
  text?: string;
  postedAt: string;
}): RecentContentDecision {
  return {
    frameId: input.frameId,
    hookStructureId: input.hookStructureId,
    openingPattern: input.openingPattern ?? firstWordsPattern(input.text),
    postedAt: input.postedAt,
  };
}
