import type {
  ContentDecision,
  ContentFrameId,
  EmotionTarget,
  HookStructureId,
  NewsMomentType,
} from "./contentArchitecture.js";
import { classifyNewsMoment } from "./contentArchitecture.js";
import type { NewsArticle } from "./fetchNews.js";
import type { TweetAnalyticsRecord } from "./analytics.js";

export interface PrePublishChecks {
  hookDetected: boolean;
  adviceDriftClear: boolean;
  openerVarietyClear: boolean;
}

export interface PrePublishEvaluation extends PrePublishChecks {
  failedChecks: string[];
}

const ADVICE_PATTERNS = [
  /\bcoaches need to\b/i,
  /\byou need to\b/i,
  /\bit'?s your job to\b/i,
  /\bdon'?t let\b/i,
  /\banticipate,\s*adapt\b/i,
  /\brecord your thoughts\b/i,
  /\bdocument your thoughts\b/i,
  /\bmake every word count\b/i,
];

export function detectHookStructure(text: string): HookStructureId | null {
  const trimmed = text.trim();
  if (/^\d+/.test(trimmed)) return "specific_number";
  if (/^(the timeout|the halftime|the play|the rep|the possession|the conversation|the first|the second|the third|the fourth|the drive|the sequence|the adjustment|the call|the moment)\b/i.test(trimmed)) return "named_moment";
  if (/^(it'?s|by|after|before|on|when|in the|this season|last night|last week|last season)\b/i.test(trimmed)) return "scene_setter";
  if (/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*[^a-zA-Z0-9\s]s\b/.test(trimmed)) return "scene_setter";
  if (/^(every coach has|every staff has|every staff\b|most teams|the player who|coaches know|the hardest part)\b/i.test(trimmed)) return "universal_truth";
  if (/\bfans\b.*\bcoaches\b|\bcoaches\b.*\bfans\b|\bpublic narrative\b/i.test(trimmed)) return "insider_divide";
  // Hot Take Dare: bold declarative claims, often absolutist
  if (/^(if you|any coach who|the worst|the best|nobody|no coach|stop)\b/i.test(trimmed)) return "hot_take_dare";
  if (/\boverrated\b|\bwaste of time\b|\bdoes not work\b|\bdoesn'?t work\b/i.test(trimmed.split(/[.!?]/)[0] ?? "")) return "hot_take_dare";
  // Unfinished Thought: ends with tension, ellipsis, or open question
  if (/[.]\s*$/.test(trimmed) && !/[!?]/.test(trimmed) && /\bbut\b|\band yet\b|\bstill\b/i.test(trimmed.split(/[.]/).slice(-2).join("."))) return "unfinished_thought";
  if (/\bnot\b.*\bbut\b|\blooks\b.*\bbut\b|\bwin\b.*\bloss\b|\bbox score\b/i.test(trimmed)) return "contradiction";
  if (/^(everyone thinks|they won but)\b/i.test(trimmed)) return "contradiction";
  if (/\byet\b|\bstill\b/.test(trimmed.split(/[.!?]/)[0] ?? "")) return "contradiction";
  return null;
}

export function getOpeningPattern(text: string): string {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.startsWith("most teams")) return "most_teams";
  const hook = detectHookStructure(text);
  return hook ?? trimmed.split(/\s+/).slice(0, 2).join("_");
}

export function checkAdviceDrift(text: string): boolean {
  return !ADVICE_PATTERNS.some((pattern) => pattern.test(text));
}

export interface EvaluatePrePublishChecksOptions {
  relaxHookCheck?: boolean;
}

export function evaluatePrePublishChecks(
  text: string,
  decision: ContentDecision,
  recentOpeningPatterns: string[],
  options?: EvaluatePrePublishChecksOptions
): PrePublishEvaluation {
  const detectedHook = detectHookStructure(text);
  const hookDetected = options?.relaxHookCheck
    ? true
    : detectedHook === decision.hookStructureId;
  const adviceDriftClear = checkAdviceDrift(text);
  const nextPattern = getOpeningPattern(text);
  const recentMostTeams = recentOpeningPatterns.filter((pattern) => pattern === "most_teams").length;
  const openerVarietyClear = !(nextPattern === "most_teams" && recentMostTeams > 0);
  const failedChecks: string[] = [];

  if (!hookDetected) failedChecks.push("hook_detected");
  if (!adviceDriftClear) failedChecks.push("advice_drift_clear");
  if (!openerVarietyClear) failedChecks.push("opener_variety_clear");

  return {
    hookDetected,
    adviceDriftClear,
    openerVarietyClear,
    failedChecks,
  };
}

export function inferFrameFromRecord(record: Pick<TweetAnalyticsRecord, "text" | "newsUsed" | "newsArticleTitle">): ContentFrameId {
  const text = record.text.toLowerCase();
  if (record.newsUsed && record.newsArticleTitle) {
    const newsMoment = classifyNewsMoment({
      sourceName: "",
      title: record.newsArticleTitle,
      url: "",
      publishedAt: "",
    } as NewsArticle);
    if (newsMoment === "halftime_comeback" || newsMoment === "unknown") return "moment_nobody_captures";
    if (newsMoment === "upset") return "scoreboard_lie";
    if (newsMoment === "star_underperformance") return "development_gap";
    if (newsMoment === "coaching_change") return "conversation_that_doesnt_happen";
    if (newsMoment === "season_review") return "forty_eight_hour_window";
    if (newsMoment === "viral_film_breakdown") return "film_room_truth";
  }
  if (/\bbox score\b|\bscoreline\b|\bfans\b|\bpublic narrative\b|\befficiency ratings?\b/.test(text)) return "scoreboard_lie";
  if (/\bfilm\b|\breview\b|\bprojector\b|\b48 hours\b|\bhours\b|\bdissect/.test(text)) return "film_room_truth";
  if (/\bfinal whistle\b|\bthursday\b|\bfirst hour\b|\bwindow\b/.test(text)) return "forty_eight_hour_window";
  if (/\bplayer\b|\bpractice\b|\bgames\b|\bseason\b|\btalent\b|\bexecution\b/.test(text)) return "development_gap";
  if (/\blocker room\b|\bdrive home\b|\bhalftime\b|\bconversation\b|\bmessage\b/.test(text)) return "conversation_that_doesnt_happen";
  if (/\btimeout\b|\b2-minute\b|\bhalftime adjustment\b|\bplay\b|\bpossession\b/.test(text)) return "moment_nobody_captures";
  return record.newsUsed ? "moment_nobody_captures" : "development_gap";
}

export function inferHookFromText(text: string): HookStructureId {
  return detectHookStructure(text) ?? "universal_truth";
}

export function inferEmotionFromText(text: string, frameId: ContentFrameId): EmotionTarget {
  const normalized = text.toLowerCase();
  if (/\bfrustrat|\bstall|\bnever figured out\b|\bscrambl/.test(normalized)) return "frustration";
  if (/\bfeel seen\b|\bevery coach has\b|\ball-too-familiar\b/.test(normalized)) return "validation";
  if (/\bfans\b|\bpublic\b|\bbox score\b/.test(normalized)) return "insider_pride";
  if (/\blost\b|\bdisappear\b|\bvanish\b|\bwindow\b/.test(normalized)) return "loss";
  if (/\burgent\b|\b48 hours\b|\bfirst hour\b/.test(normalized)) return "urgency";
  if (/\buncomfortable\b|\btruth\b|\bwon't admit\b/.test(normalized)) return "provocation";
  if (/\bdrive home\b|\blocker room\b|\bmeant to say\b/.test(normalized)) return "vulnerability";

  const byFrame: Record<ContentFrameId, EmotionTarget> = {
    forty_eight_hour_window: "urgency",
    film_room_truth: "provocation",
    development_gap: "frustration",
    moment_nobody_captures: "loss",
    scoreboard_lie: "insider_pride",
    conversation_that_doesnt_happen: "vulnerability",
  };
  return byFrame[frameId];
}

export function inferNewsMomentType(title?: string): NewsMomentType {
  if (!title) return "unknown";
  return classifyNewsMoment({
    sourceName: "",
    title,
    url: "",
    publishedAt: "",
  } as NewsArticle);
}
