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
import type { FetchedData } from "./fetchData.js";
import type { NewsContext } from "./fetchNews.js";
import { isValidTweet, BRAND_NAME, BRAND_WEBSITE } from "./validate.js";

const BRAND_SUFFIX = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;
const USER_MESSAGE_TEMPLATE = `Context: this post is for the {sport} coaching audience. Date: {date}. Focus theme: {angle}. Archetype: {archetype}.

Write like a sharp X creator, coach, or analyst, not a SaaS brand account.

Tweet rules:
1. Open with a strong take, sharp observation, or timely angle. The first sentence should feel punchy and scroll-stopping.
2. Use 2 short sentences max before the light brand tag.
3. Sound opinionated, specific, and conversational. Prioritize tension, clarity, and real coaching insight.
4. Do not write a scoreboard recap, matchup line, live score update, or "Team A at Team B" post.
5. Do not sound like a product ad. The body should stand on its own as a valuable post even without the brand tag.
6. Mention {brand_name} only once, in a light tag at the end as "{brand_name} · {brand_website}".
7. Prefer zero hashtags. Use one only if it genuinely adds context.
8. Stay within the active platform character limit before any tracked link is appended.
9. Archetype rule: {archetype_guidance}
10. Do not tell the reader what to do. No "coaches need to", "record your thoughts", "document your thoughts", "make every word count", or other instructional CTA language in the main body.

Banned phrases and tones:
- "research shows"
- "helps you"
- "turn your postgame thoughts into"
- "organized development notes"
- "actionable insights"
- "player growth"
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
  ` Your last reply was too long, incomplete, too promotional, instructional, or sounded like a scoreboard/news recap. Write a NEW tweet in a sharper creator voice: 2 short sentences max, specific, opinionated, not corporate, under the limit, with only one light "${BRAND_NAME} · ${BRAND_WEBSITE}" tag at the end. No advice-style lines like "coaches need to" or "record your thoughts". Reply with only the tweet text.`;

const AVOID_FOLLOWUP =
  ` Your previous suggestion was too similar to a recent post. Write a DIFFERENT tweet with a new hook, different wording, and a different angle. Reply with only the tweet text.`;

const AD_FOLLOWUP =
  ` Your previous reply sounded like marketing copy. Rewrite it with more edge and less sales language. No "research shows", no "helps you", no "actionable insights", no generic product explanation.`;

const NEWS_ENTITY_FOLLOWUP =
  ` Your previous reply ignored the specific headline context. Rewrite it so the first sentence clearly references the key team, player, event, or trend from the headline.`;

const INSTRUCTIONAL_FOLLOWUP =
  ` Your previous reply sounded too instructional. Rewrite it as an observation or take, not advice. No "coaches need to", "record your thoughts", "document your thoughts", or "make every word count".`;

const COMPRESSION_FOLLOWUP =
  ` Compress the tweet you just wrote so it fits the character limit. Keep the same hook, remove filler, keep "postgame AI" and "getpostgame.ai", and reply with only the shortened tweet.`;

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
    "Use the headline as the hook. Name the team, player, or event early. Then make one sharp coaching point about what it reveals. Avoid abstract motivational language.",
  contrarian_take:
    "Open with a contrarian coaching claim like 'Most teams...' or 'The problem is not...'. Sound skeptical and clean. Do not use the words feedback, generic, or specific. Do not tell the audience what to do.",
  coaching_truth:
    "Write one blunt coaching truth that sounds earned, not inspirational. Short, hard-edged, direct. Do not use the words feedback, generic, or specific. No instruction or CTA tone.",
  trend_observation:
    "Point at a pattern coaches can recognize in the sport right now. Use language like reveals, exposes, punishes, rewards, or shows. Do not use the words feedback, generic, or specific. Avoid telling coaches what to do.",
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
): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  const system = loadSystemPrompt();
  const sport = (fetchedData.sport ?? "sports").toLowerCase();
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const angle = options.angle ?? "film review, feedback, or preparation (pick one)";
  const maxBodyLength = Math.max(180, MAX_POST_LEN - Math.max(0, options.reserveChars ?? 0));
  const archetype = selectArchetype(sport, date, Boolean(options.newsContext?.usedNews));
  const archetypeGuidance = ARCHETYPE_GUIDANCE[archetype];
  const avoidBlock =
    (options.recentTweets?.length ?? 0) > 0
      ? `\nDo NOT repeat or closely mimic these recent tweets:\n${options.recentTweets!.slice(0, 12).map((t) => `- ${t}`).join("\n")}`
      : "";
  const iterationBlock = options.iterationGuidance
    ? `\nIteration guidance from recent tweet analytics (follow these patterns):\n${options.iterationGuidance}`
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
- Turn the article into a coaching, performance, development, or preparation insight.
- Prefer one of these structures: trend -> why it matters for coaches -> postgame AI; news event -> coaching lesson -> postgame AI; performance shift -> development takeaway -> postgame AI.
- Keep the product mention light. The main body should read like a real take, not product copy.`
      : "";
  let userMessage = USER_MESSAGE_TEMPLATE.replace(/\{sport\}/g, sport)
    .replace(/\{date\}/g, date)
    .replace(/\{angle\}/g, angle)
    .replace(/\{archetype\}/g, archetype)
    .replace(/\{archetype_guidance\}/g, archetypeGuidance)
    .replace(/\{brand_name\}/g, BRAND_NAME)
    .replace(/\{brand_website\}/g, BRAND_WEBSITE)
    .replace(/\{avoid_block\}/g, avoidBlock)
    .replace(/\{iteration_block\}/g, iterationBlock);
  userMessage += `${newsBlock}\nReserve space for a short tracking link appended automatically. Keep the body under ${maxBodyLength} characters.`;

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  const client = new OpenAI(clientOptions);

  let lastContent: string | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) userMessage += STRICT_FOLLOWUP;
      const raw = await requestTweet(client, system, userMessage);
      if (raw) {
        let content = raw;
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
          if (soundsLikeAd(content)) {
            userMessage += AD_FOLLOWUP;
            continue;
          }
          if (soundsInstructional(content)) {
            userMessage += INSTRUCTIONAL_FOLLOWUP;
            continue;
          }
          if (usesRepetitivePhraseFamily(content)) {
            userMessage +=
              " Avoid the repeated phrase family around generic/specific feedback, generic/specific notes, targeted notes, postgame chats, and player development. Use different language.";
            continue;
          }
          if (
            options.newsContext?.usedNews &&
            options.newsContext.selectedArticle?.title &&
            !referencesHeadline(content, options.newsContext.selectedArticle.title, sport)
          ) {
            userMessage += NEWS_ENTITY_FOLLOWUP;
            continue;
          }
          return content;
        }
      }
    } catch (err) {
      console.warn(`LLM attempt ${attempt + 1} failed:`, err);
    }
  }
  return lastContent;
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
