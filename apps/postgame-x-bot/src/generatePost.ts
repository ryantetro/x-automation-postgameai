import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import {
  OPENAI_API_KEY,
  USE_OPENAI_API,
  LLM_BASE_URL,
  ACTIVE_LLM_MODEL,
  PROMPTS_DIR,
  MAX_POST_LEN,
} from "./config.js";
import type { ContentDecision, RecentContentDecision } from "./contentArchitecture.js";
import { FRAME_DEFINITIONS, HOOK_DEFINITIONS } from "./contentArchitecture.js";
import { evaluatePrePublishChecks, getOpeningPattern } from "./contentHeuristics.js";
import type { FetchedData } from "./fetchData.js";
import type { NewsContext } from "./fetchNews.js";
import { isValidTweet, BRAND_NAME, BRAND_WEBSITE } from "./validate.js";

const BRAND_SUFFIX = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;
const USER_MESSAGE_TEMPLATE = `Context: this post is for the {sport} coaching audience. Date: {date}. Focus theme: {angle}. Frame: {frame_label}. Hook structure: {hook_label}. Emotional target: {emotion_target}.

Write like a former coach turned analyst, not a SaaS brand account.

Post requirements:
1. The first 8 words must earn the scroll-stop. Lead with tension, a hard truth, or a counterintuitive observation. Not a question. Not a stat dump. Not a score recap.
2. Make coaches feel recognized. The post should sound like something a real coach would screenshot and send to staff.
3. Use no more than 2 tight sentences before the brand tag.
4. The body must stand on its own as a strong post even without the brand tag.
5. Mention {brand_name} only once, lightly, at the end as "{brand_name} · {brand_website}".
6. Prefer zero hashtags. Use one only if it sharpens the post.
7. Stay within the active platform character limit before any tracked link is appended.
8. Archetype rule: {archetype_guidance}
9. Do not tell the reader what to do. No instructional CTA language in the main body.
10. News is the hook, not the subject. Use the headline as the excuse to post, then pivot to the coaching truth it reveals.
11. Describe, never prescribe. The post must describe a situation coaches recognize. It must not tell them what to do about it.
12. Do not open with "Most teams" if that opener has already been used in the recent batch.

Positive voice model:
- Sound like this: "Most coaches know the feeling - you saw exactly what went wrong at halftime, then it's gone by Thursday. That's the whole problem."
- Not like this: "postgame AI helps coaches turn thoughts into organized development notes."

Frame territory:
{frame_territory}

Frame instruction block:
{frame_instruction}

Hook guidance:
{hook_guidance}

Avoid these phrases and tones:
- "research shows"
- "helps you"
- "helps coaches"
- "turn your postgame thoughts into"
- "organized development notes"
- "actionable insights"
- "player growth"
- "player development" as a generic slogan
- "seamlessly"
- "generic feedback"
- "specific feedback"
- "generic notes"
- "specific notes"
- "coaches need to"
- "record your thoughts"
- "document your thoughts"
- "use your voice"
- "make every word count"
- "after every game"
- generic SaaS/corporate wording

{avoid_block}
{iteration_block}`;

const STRICT_FOLLOWUP =
  ` Your last reply was too long, incomplete, too promotional, instructional, or sounded like a scoreboard/news recap. Write a NEW post in a sharper former-coach voice: hard-edged, specific, and screenshot-worthy for a staff chat. Use 2 short sentences max, stay under the limit, and end with one light "${BRAND_NAME} · ${BRAND_WEBSITE}" tag. No advice-style lines like "coaches need to" or "record your thoughts". Reply with only the post text.`;

const AVOID_FOLLOWUP =
  ` Your previous suggestion was too similar to a recent post. Write a DIFFERENT post with a new hook, different wording, and a different coaching tension. Reply with only the post text.`;

const AD_FOLLOWUP =
  ` Your previous reply sounded like marketing copy. Rewrite it with more edge, more lived-in coaching language, and less sales wording. No "research shows", no "helps you", no "actionable insights", and no generic product explanation.`;

const NEWS_ENTITY_FOLLOWUP =
  ` Your previous reply ignored the specific headline context. Rewrite it so the first sentence clearly references the key team, player, event, or trend from the headline, then pivot to the coaching truth beneath it.`;

const INSTRUCTIONAL_FOLLOWUP =
  ` Your previous reply sounded too instructional. Rewrite it as an observation or take, not advice. No "coaches need to", "record your thoughts", "document your thoughts", or "make every word count". Make it sound like recognition, frustration, or validation - not guidance.`;

const COMPRESSION_FOLLOWUP =
  ` Compress the post you just wrote so it fits the character limit. Keep the same hook, remove filler, keep "postgame AI" and "getpostgame.ai", and reply with only the shortened post.`;

const WEAK_OPENER_FOLLOWUP =
  ` Your previous opener did not clearly match the assigned hook structure. Rewrite the opening so the first 8 words unmistakably fit the assigned hook type while keeping the same frame and coaching tension.`;

const OPENER_VARIETY_FOLLOWUP =
  ` Your previous opener repeated an overused opening pattern from the recent batch. Rewrite it with a different opening structure and do not begin with "Most teams".`;

const SPORT_HASHTAGS: Record<string, string> = {
  nba: "",
  nfl: "",
  mlb: "",
  soccer: "",
};

const FALLBACK_FACTS: Record<string, Record<string, string>> = {
  default: {
    film: "Most postgame review fails because it tries to cover everything.",
    feedback: "Most coaches do not need more words after games. They need cleaner teaching points.",
    preparation: "Preparation usually breaks down in bad notes, not bad ideas.",
    efficiency: "The biggest coaching edge is usually clarity, not volume.",
    adjustments: "Great adjustments usually start with the right 2 moments, not 20.",
    analytics: "Data is not the bottleneck. Turning it into coaching language is.",
  },
  nba: {
    film: "Most basketball film sessions are too long to be useful.",
    feedback: "The best basketball coaching usually comes down to one possession and one correction.",
    preparation: "Matchup prep gets sharper when staffs stop drowning in their own notes.",
    efficiency: "Shot quality usually tells the truth faster than the box score does.",
    adjustments: "Momentum flips are usually visible before the final score makes them obvious.",
    analytics: "Useful basketball analytics should change teaching, not just slides.",
  },
  nfl: {
    film: "Football staffs do not need more film. They need clearer corrections.",
    feedback: "The fastest football improvement usually comes from one rep and one coaching point.",
    preparation: "Good football prep looks boring right up until chaos hits.",
    efficiency: "Down, distance, and field position usually expose the real coaching problems.",
    adjustments: "The best sideline adjustments start before the coordinator says a word.",
    analytics: "Football analytics matter when they sharpen decisions, not when they decorate reports.",
  },
  mlb: {
    film: "Baseball review gets noisy fast when every inning makes the cut.",
    feedback: "The best baseball teaching usually starts with one sequence, not a full lecture.",
    preparation: "Good baseball prep is usually just clean matchup thinking.",
    efficiency: "Leverage swings usually tell you more than the final line does.",
    adjustments: "The best baseball adjustments usually happen before panic shows up.",
    analytics: "Baseball data is useful when it survives the trip from spreadsheet to dugout.",
  },
  soccer: {
    film: "Most match review fails because it tries to coach every phase at once.",
    feedback: "The best soccer coaching point is usually one sequence and one tactical fix.",
    preparation: "Soccer prep gets easier when the notes are clearer than the match chaos.",
    efficiency: "Territory and defensive balance usually matter before the scoreline catches up.",
    adjustments: "Good match adjustments usually start with shape, not speeches.",
    analytics: "Soccer analytics only matter if they survive contact with real coaching.",
  },
};

const VIRAL_ARCHETYPES = ["news_take", "contrarian_take", "coaching_truth", "trend_observation"] as const;
const ARCHETYPE_GUIDANCE: Record<(typeof VIRAL_ARCHETYPES)[number], string> = {
  news_take:
    "Use the headline as the hook. Name the team, player, or event early, then turn it into a sharper coaching truth fans would miss. The headline is the entry point, not the whole post.",
  contrarian_take:
    "Open with a contrarian coaching claim like 'Most teams...' or 'The problem is not...'. Sound skeptical, earned, and blunt. Do not tell the audience what to do.",
  coaching_truth:
    "Write one blunt coaching truth that sounds earned, not inspirational. Short, hard-edged, direct. It should feel like a veteran coach finally saying the quiet part out loud.",
  trend_observation:
    "Point at a pattern coaches can recognize in the sport right now. Use language like reveals, exposes, punishes, rewards, or shows. Make the reader feel immediate recognition, not instruction.",
};
const BANNED_AD_PHRASES = [
  "research shows",
  "helps you",
  "turn your postgame thoughts into",
  "organized development notes",
  "actionable insights",
  "player growth",
  "seamlessly",
  "maximize growth",
  "what the app helps",
  "built for",
  "generic feedback",
  "specific feedback",
  "generic notes",
  "specific notes",
  "targeted notes",
  "targeted critiques",
  "coaches need to",
  "record your thoughts",
  "document your thoughts",
  "use your voice",
  "make every word count",
  "after every game",
];
const MARKETING_TERMS = ["actionable", "seamless", "effortlessly", "powerful", "maximize", "transform", "organized"];
const REPETITIVE_PHRASE_PATTERNS = [
  /\bgeneric\b.{0,20}\bfeedback\b/i,
  /\bspecific\b.{0,20}\bfeedback\b/i,
  /\bgeneric\b.{0,20}\bnotes\b/i,
  /\bspecific\b.{0,20}\bnotes\b/i,
  /\btargeted\b.{0,20}\bnotes\b/i,
  /\btargeted\b.{0,20}\bcritiques?\b/i,
  /\bpostgame chats?\b/i,
  /\bplayer development\b/i,
  /\bvague\b.{0,20}\bcomments?\b/i,
  /\bclear\b.{0,20}\bpointers?\b/i,
];
const INSTRUCTIONAL_PATTERNS = [
  /\bcoaches need to\b/i,
  /\byou need to\b/i,
  /\brecord your thoughts\b/i,
  /\bdocument your thoughts\b/i,
  /\bmake every word count\b/i,
  /\buse your voice\b/i,
  /\bafter every game\b/i,
  /\bnow'?s the time to\b/i,
];
const TITLE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "from",
  "into",
  "what",
  "would",
  "before",
  "after",
  "today",
  "their",
  "this",
  "your",
  "have",
  "about",
  "will",
  "just",
  "more",
  "than",
  "when",
  "where",
  "while",
  "were",
  "which",
  "ended",
  "projected",
  "picture",
  "bracket",
  "free",
  "agency",
]);

export interface GeneratePostOptions {
  /** Recent tweet texts to avoid repeating (for uniqueness). */
  recentTweets?: string[];
  /** Focus/angle for the fact (e.g. film review timing, specific feedback). */
  angle?: string;
  /** Date string for prompt context (e.g. 2026-02-27). */
  date?: string;
  /** Insights from prior analytics to iterate toward winning patterns. */
  iterationGuidance?: string;
  /** Characters to reserve for a tracked link appended after generation. */
  reserveChars?: number;
  /** Optional news context to drive a more timely hook when available. */
  newsContext?: NewsContext;
  /** Pre-selected architecture decision for this post. */
  contentDecision?: ContentDecision;
  /** Recent content decisions for opener variety and hook rotation. */
  recentContentDecisions?: RecentContentDecision[];
}

export interface GeneratePostAttempt {
  attemptId: string;
  rawOutput?: string;
  cleanedOutput?: string;
  passedChecks: string[];
  failedChecks: string[];
  rejectionReason?: string;
  acceptedForPublish: boolean;
}

export interface GeneratePostResult {
  text: string | null;
  attempts: GeneratePostAttempt[];
  openingPattern?: string;
  prePublishChecks?: {
    hookDetected: boolean;
    adviceDriftClear: boolean;
    openerVarietyClear: boolean;
  };
}

/** Strip quotes, markdown fences, and "Tweet:"-style prefixes so validation doesn't fail on formatting. */
function cleanResponse(raw: string): string {
  let s = raw.trim();
  // Remove markdown code block if present
  const codeBlock = /^```(?:\w*)\n?([\s\S]*?)\n?```$/;
  const m = s.match(codeBlock);
  if (m) s = m[1].trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const tweetPrefix = /^(Tweet|Here'?s? the tweet|Suggested tweet):\s*/i;
  s = s.replace(tweetPrefix, "").trim();
  return s;
}

function loadSystemPrompt(): string {
  const path = resolve(PROMPTS_DIR, "system_prompt.txt");
  if (!existsSync(path)) throw new Error(`System prompt not found: ${path}`);
  return readFileSync(path, "utf-8").trim();
}

function selectArchetype(sport: string, date: string, preferNews: boolean): (typeof VIRAL_ARCHETYPES)[number] {
  if (preferNews) return "news_take";
  const seed = `${sport}:${date}`;
  const sum = [...seed].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return VIRAL_ARCHETYPES[sum % VIRAL_ARCHETYPES.length];
}

function countOccurrences(text: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(escaped, "gi"));
  return matches?.length ?? 0;
}

function soundsLikeAd(text: string): boolean {
  const normalized = text.toLowerCase();
  if (BANNED_AD_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  const marketingHits = MARKETING_TERMS.filter((term) => normalized.includes(term)).length;
  if (marketingHits >= 2) return true;
  if (countOccurrences(text, BRAND_NAME) > 1) return true;
  return false;
}

function usesRepetitivePhraseFamily(text: string): boolean {
  return REPETITIVE_PHRASE_PATTERNS.some((pattern) => pattern.test(text));
}

function soundsInstructional(text: string): boolean {
  return INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(text));
}

function extractHeadlineTerms(title: string, sport: string): string[] {
  return title
    .replace(/['’]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4)
    .filter((token) => !TITLE_STOPWORDS.has(token))
    .filter((token) => token !== sport.toLowerCase())
    .slice(0, 6);
}

function referencesHeadline(text: string, title: string, sport: string): boolean {
  const normalized = text.toLowerCase();
  const terms = extractHeadlineTerms(title, sport);
  if (terms.length === 0) return true;
  return terms.some((term) => normalized.includes(term));
}

function chooseFallbackKey(angle?: string): keyof (typeof FALLBACK_FACTS)["default"] {
  const normalized = (angle ?? "").toLowerCase();
  if (normalized.includes("film")) return "film";
  if (normalized.includes("feedback")) return "feedback";
  if (normalized.includes("opponent") || normalized.includes("preparation")) return "preparation";
  if (normalized.includes("shot") || normalized.includes("efficiency")) return "efficiency";
  if (normalized.includes("adjustment") || normalized.includes("situational")) return "adjustments";
  if (normalized.includes("data") || normalized.includes("analytic")) return "analytics";
  return "film";
}

async function requestTweet(client: OpenAI, system: string, userMessage: string): Promise<string | null> {
  const resp = await client.chat.completions.create({
    model: ACTIVE_LLM_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
    max_tokens: 120,
    temperature: 0.8,
  });
  return cleanResponse(resp.choices?.[0]?.message?.content?.trim() ?? "");
}

async function compressTweetToFit(
  client: OpenAI,
  system: string,
  original: string,
  maxBodyLength: number
): Promise<string | null> {
  const shortened = await requestTweet(
    client,
    system,
    `${COMPRESSION_FOLLOWUP}\nLimit: ${maxBodyLength} characters.\nTweet:\n${original}`
  );
  return shortened && shortened.length <= maxBodyLength ? shortened : null;
}

export async function generatePost(
  fetchedData: FetchedData,
  maxRetries = 3,
  options: GeneratePostOptions = {}
): Promise<GeneratePostResult> {
  if (!OPENAI_API_KEY) return { text: null, attempts: [] };
  const system = loadSystemPrompt();
  const sport = (fetchedData.sport ?? "sports").toLowerCase();
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const angle = options.angle ?? "film review, feedback, or preparation (pick one)";
  const maxBodyLength = Math.max(180, MAX_POST_LEN - Math.max(0, options.reserveChars ?? 0));
  const contentDecision = options.contentDecision;
  if (!contentDecision) return { text: null, attempts: [] };
  const archetype = selectArchetype(sport, date, Boolean(options.newsContext?.usedNews));
  const archetypeGuidance = ARCHETYPE_GUIDANCE[archetype];
  const frame = FRAME_DEFINITIONS[contentDecision.frameId];
  const hook = HOOK_DEFINITIONS[contentDecision.hookStructureId];
  const avoidBlock =
    (options.recentTweets?.length ?? 0) > 0
      ? `\nDo NOT repeat or closely mimic these recent tweets:\n${options.recentTweets!.slice(0, 12).map((t) => `- ${t}`).join("\n")}`
      : "";
  const iterationBlock = options.iterationGuidance
    ? `\nIteration guidance from recent post analytics:
- Learn from why strong posts worked, not just what they said.
- Weight toward hooks that surface tension, uncomfortable truths, or strong coach recognition.
- Notice whether the winning post triggered recognition, frustration, or validation.
- Follow these patterns:\n${options.iterationGuidance}`
    : "";
  const newsBlock =
    options.newsContext?.usedNews && options.newsContext.selectedArticle
      ? `\nUse this timely news angle if it helps:
- Headline: ${options.newsContext.selectedArticle.title}
- Source: ${options.newsContext.selectedArticle.sourceName}
- Published: ${options.newsContext.selectedArticle.publishedAt}
- Description: ${options.newsContext.selectedArticle.description ?? "n/a"}
Rules for news usage:
- Use only facts clearly present in the article context above.
- The first sentence must clearly reference the specific event, team, player, or trend in the headline above.
- Do not sound like a headline repost or news wire account.
- Do not explicitly cite the publisher unless necessary for clarity.
- The headline is your excuse to post. The real post is about what coaches know that fans do not.
- Turn the article into a coaching, performance, development, or preparation insight.
- Prefer one of these structures: trend -> what it reveals -> postgame AI; news event -> coaching truth -> postgame AI; performance shift -> uncomfortable takeaway -> postgame AI.
- Keep the product mention light. The main body should read like a real take, not product copy.`
      : "";
  let userMessage = USER_MESSAGE_TEMPLATE.replace(/\{sport\}/g, sport)
    .replace(/\{date\}/g, date)
    .replace(/\{angle\}/g, angle)
    .replace(/\{frame_label\}/g, frame.label)
    .replace(/\{hook_label\}/g, hook.label)
    .replace(/\{emotion_target\}/g, contentDecision.emotionTarget)
    .replace(/\{archetype_guidance\}/g, archetypeGuidance)
    .replace(/\{frame_territory\}/g, frame.territory)
    .replace(/\{frame_instruction\}/g, frame.instructionBlock)
    .replace(/\{hook_guidance\}/g, hook.openingGuidance)
    .replace(/\{brand_name\}/g, BRAND_NAME)
    .replace(/\{brand_website\}/g, BRAND_WEBSITE)
    .replace(/\{avoid_block\}/g, avoidBlock)
    .replace(/\{iteration_block\}/g, iterationBlock);
  userMessage += `${newsBlock}\nReserve space for a short tracking link appended automatically. Keep the body under ${maxBodyLength} characters.`;

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  const client = new OpenAI(clientOptions);

  let lastContent: string | null = null;
  let lastEvaluation:
    | {
        hookDetected: boolean;
        adviceDriftClear: boolean;
        openerVarietyClear: boolean;
      }
    | undefined;
  const attempts: GeneratePostAttempt[] = [];
  const recentOpeningPatterns = (options.recentContentDecisions ?? []).map((decision) => decision.openingPattern ?? "");

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const attemptRecord: GeneratePostAttempt = {
      attemptId: `${Date.now()}-${attempt + 1}`,
      passedChecks: [],
      failedChecks: [],
      acceptedForPublish: false,
    };
    try {
      if (attempt > 0) userMessage += STRICT_FOLLOWUP;
      const raw = await requestTweet(client, system, userMessage);
      if (raw) {
        let content = raw;
        attemptRecord.rawOutput = raw;
        lastContent = content;
        if (content) {
          const hasName = content.includes(BRAND_NAME);
          const hasWebsite = content.includes(BRAND_WEBSITE);
          if ((!hasName || !hasWebsite) && content.length <= MAX_POST_LEN - BRAND_SUFFIX.length) {
            content = `${content.trim()}${BRAND_SUFFIX}`;
          }
          if (content.length > maxBodyLength) {
            const compressed = await compressTweetToFit(client, system, content, maxBodyLength);
            if (compressed) content = compressed;
          }
          if (content.length > MAX_POST_LEN) {
            console.warn(`LLM returned ${content.length} chars (max ${MAX_POST_LEN})`);
          }
          if (!content.includes(BRAND_NAME)) console.warn(`LLM response missing ${BRAND_NAME}`);
          if (!content.includes(BRAND_WEBSITE)) console.warn(`LLM response missing ${BRAND_WEBSITE}`);
          attemptRecord.cleanedOutput = content;
          if (soundsLikeAd(content)) {
            attemptRecord.failedChecks.push("ad_tone");
            attemptRecord.rejectionReason = "marketing_copy";
            attempts.push(attemptRecord);
            userMessage += AD_FOLLOWUP;
            continue;
          }
          if (soundsInstructional(content)) {
            attemptRecord.failedChecks.push("advice_drift_clear");
            attemptRecord.rejectionReason = "instructional_drift";
            attempts.push(attemptRecord);
            userMessage += INSTRUCTIONAL_FOLLOWUP;
            continue;
          }
          if (usesRepetitivePhraseFamily(content)) {
            attemptRecord.failedChecks.push("repetitive_phrase_family");
            attemptRecord.rejectionReason = "repetitive_phrase_family";
            attempts.push(attemptRecord);
            userMessage +=
              " Avoid the repeated phrase family around generic/specific feedback, generic/specific notes, targeted notes, postgame chats, and player development. Use different language.";
            continue;
          }
          if (
            options.newsContext?.usedNews &&
            options.newsContext.selectedArticle?.title &&
            !referencesHeadline(content, options.newsContext.selectedArticle.title, sport)
          ) {
            attemptRecord.failedChecks.push("headline_reference");
            attemptRecord.rejectionReason = "headline_context_missing";
            attempts.push(attemptRecord);
            userMessage += NEWS_ENTITY_FOLLOWUP;
            continue;
          }
          const evaluation = evaluatePrePublishChecks(content, contentDecision, recentOpeningPatterns, {
            relaxHookCheck: attempt === maxRetries - 1,
          });
          lastEvaluation = evaluation;
          if (!evaluation.hookDetected) {
            attemptRecord.failedChecks.push("hook_detected");
            attemptRecord.rejectionReason = "weak_opener";
            attempts.push(attemptRecord);
            userMessage += WEAK_OPENER_FOLLOWUP;
            continue;
          }
          if (!evaluation.openerVarietyClear) {
            attemptRecord.failedChecks.push("opener_variety_clear");
            attemptRecord.rejectionReason = "opener_overuse";
            attempts.push(attemptRecord);
            userMessage += OPENER_VARIETY_FOLLOWUP;
            continue;
          }
          attemptRecord.passedChecks.push("hook_detected", "advice_drift_clear", "opener_variety_clear");
          attemptRecord.acceptedForPublish = true;
          attempts.push(attemptRecord);
          return {
            text: content,
            attempts,
            openingPattern: getOpeningPattern(content),
            prePublishChecks: {
              hookDetected: evaluation.hookDetected,
              adviceDriftClear: evaluation.adviceDriftClear,
              openerVarietyClear: evaluation.openerVarietyClear,
            },
          };
        }
      }
    } catch (err) {
      console.warn(`LLM attempt ${attempt + 1} failed:`, err);
      attemptRecord.failedChecks.push("llm_error");
      attemptRecord.rejectionReason = "llm_error";
      attempts.push(attemptRecord);
    }
  }
  return {
    text: null,
    attempts,
    openingPattern: lastContent ? getOpeningPattern(lastContent) : undefined,
    prePublishChecks: lastEvaluation
      ? {
          hookDetected: lastEvaluation.hookDetected,
          adviceDriftClear: lastEvaluation.adviceDriftClear,
          openerVarietyClear: lastEvaluation.openerVarietyClear,
        }
      : undefined,
  };
}

export function fillFallbackTemplate(
  sport: string,
  _fetchedData: FetchedData,
  options: { reserveChars?: number; angle?: string } = {}
): string {
  const sportKey = sport.toLowerCase();
  const factKey = chooseFallbackKey(options.angle);
  const sportFacts = FALLBACK_FACTS[sportKey] ?? FALLBACK_FACTS.default;
  const hashtags = SPORT_HASHTAGS[sportKey] ?? "#CoachingTips";
  const body = `${sportFacts[factKey]} The best staffs usually win the review before they win the next game.`;
  let text = `${body} ${BRAND_NAME} · ${BRAND_WEBSITE} ${hashtags}`.trim();
  const reservedChars = Math.max(0, options.reserveChars ?? 0);
  const maxLen = Math.max(0, MAX_POST_LEN - reservedChars);
  if (text.length > maxLen) {
    text = `${sportFacts[factKey]} ${BRAND_NAME} · ${BRAND_WEBSITE} ${hashtags}`.trim();
  }
  return text.slice(0, maxLen);
}
