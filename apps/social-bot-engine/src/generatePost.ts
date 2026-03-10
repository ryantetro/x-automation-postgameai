import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import {
  OPENAI_API_KEY,
  USE_OPENAI_API,
  LLM_BASE_URL,
  ACTIVE_LLM_MODEL,
  PROMPTS_DIR,
  CAMPAIGNS_DIR,
  DATA_SOURCE,
  MAX_POST_LEN,
} from "./config.js";
import { loadPillarForAngle } from "./contentPillars.js";
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
6. Add 1-2 relevant coaching hashtags at the end if there is room. Keep them specific to the sport and coaching community.
7. Stay within the active platform character limit before any tracked link is appended.
8. Archetype rule: {archetype_guidance}
9. Do not tell the reader what to do. No instructional CTA language in the main body.
10. News is the hook, not the subject. Use the headline as the excuse to post, then pivot to the coaching truth it reveals.
11. Describe, never prescribe. The post must describe a situation coaches recognize. It must not tell them what to do about it.
12. Do not open with "Most teams" if that opener has already been used in the recent batch.

Voice: Write like a real coach talking to other coaches — blunt, specific, lived-in. Not a brand. Not a newsletter. Not a motivational poster. If you would not screenshot it and send it to your staff, it is not good enough.

Example posts that nail the voice (study the rhythm, not the exact words):
- "Most coaches know the feeling — you saw exactly what went wrong at halftime, then it's gone by Thursday. That is the whole problem."
- "Three possessions decided that game. By Monday the staff will only remember the last one."
- "Film does not lie, but it wastes your time if nobody decides what to look for before pressing play."
- "The gap between 'we need to be tougher' and actually coaching toughness is where most staffs get stuck."

Do NOT sound like this:
- "postgame AI helps coaches turn thoughts into organized development notes."
- "Research shows that coaches who review film within 24 hours see a 30% improvement."

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

function strictFollowup(hookLabel: string): string {
  return ` Your last reply was too long, incomplete, too promotional, instructional, or sounded like a scoreboard/news recap. Write a NEW post in a sharper former-coach voice: hard-edged, specific, and screenshot-worthy for a staff chat. Use 2 short sentences max, stay under the limit, and end with one light "${BRAND_NAME} · ${BRAND_WEBSITE}" tag. No advice-style lines like "coaches need to" or "record your thoughts". Your opening must fit the "${hookLabel}" hook structure. Reply with only the post text.`;
}

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

function weakOpenerFollowup(hookLabel: string): string {
  return ` Your previous opener did not clearly match the assigned hook structure ("${hookLabel}"). Rewrite the opening so the first 8 words unmistakably fit the "${hookLabel}" hook type while keeping the same frame and coaching tension.`;
}

const OPENER_VARIETY_FOLLOWUP =
  ` Your previous opener repeated an overused opening pattern from the recent batch. Rewrite it with a different opening structure and do not begin with "Most teams".`;

const SPORT_HASHTAG_POOLS: Record<string, string[]> = {
  nba: ["#CoachingBasketball", "#HoopsFilm", "#NBACoaching", "#BasketballIQ", "#CourtVision", "#HoopsDev", "#BallerCoach"],
  nfl: ["#CoachingFootball", "#FootballFilm", "#NFLCoaching", "#GridironIQ", "#FridayNightLights", "#FootballDev", "#XsAndOs"],
  mlb: ["#CoachingBaseball", "#BaseballFilm", "#MLBCoaching", "#DiamondIQ", "#BaseballDev", "#DugoutTalk"],
  soccer: ["#CoachingSoccer", "#SoccerFilm", "#FootballCoaching", "#TacticalAnalysis", "#SoccerDev", "#PitchIQ", "#BeautifulGame"],
  default: ["#CoachingTips", "#FilmReview", "#CoachLife", "#SportsCoaching", "#GamePrep"],
};

/** Pick 1-2 random hashtags for the given sport, respecting the character budget. */
function pickHashtags(sport: string, remainingChars: number): string {
  const pool = SPORT_HASHTAG_POOLS[sport.toLowerCase()] ?? SPORT_HASHTAG_POOLS.default;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const count = Math.random() < 0.5 ? 1 : 2;
  const selected = shuffled.slice(0, count);
  const hashtags = selected.join(" ");
  // Only include if there's room (with a leading space)
  if (hashtags.length + 1 > remainingChars) {
    // Try just one hashtag
    if (selected[0] && selected[0].length + 1 <= remainingChars) return selected[0];
    return "";
  }
  return hashtags;
}

const FALLBACK_TEMPLATES: Record<string, string[]> = {
  default: [
    "Most postgame review fails because it tries to cover everything.",
    "Most coaches do not need more words after games. They need cleaner teaching points.",
    "Preparation usually breaks down in bad notes, not bad ideas.",
    "The biggest coaching edge is usually clarity, not volume.",
    "Great adjustments usually start with the right 2 moments, not 20.",
    "Data is not the bottleneck. Turning it into coaching language is.",
    "The real coaching happens between the whistle and the next morning. Everything after that is noise.",
    "A good staff meeting is 3 clips and a decision, not 40 minutes of everything that happened.",
    "The coach who says less usually fixes more. Volume is not the same as teaching.",
    "Nobody remembers the 10 good possessions. Everyone remembers the 2 that fell apart.",
    "Film does not lie. But it can waste your time if you let it show you everything at once.",
    "The best corrections are specific enough to act on and short enough to remember.",
    "When in doubt, fewer points hit harder. One clear takeaway beats a notebook full of ideas.",
    "A development plan only works when it survives the chaos of the next game.",
    "Every staff has a moment after the game when the real insight is obvious. Most lose it by morning.",
    "The difference between a good staff and a great staff is usually one honest conversation.",
  ],
  nba: [
    "Most basketball film sessions are too long to be useful.",
    "The best basketball coaching usually comes down to one possession and one correction.",
    "Matchup prep gets sharper when staffs stop drowning in their own notes.",
    "Shot quality usually tells the truth faster than the box score does.",
    "Momentum flips are usually visible before the final score makes them obvious.",
    "Useful basketball analytics should change teaching, not just slides.",
    "The difference between a rotation player and a starter is usually one read they keep missing.",
    "A timeout is only worth calling if the message survives the next 3 possessions.",
    "Half the fourth quarter is decided by who prepared for the other team's tendencies, not who wanted it more.",
    "The real evaluation happens in transition. Everything else just confirms what you already saw.",
    "If your players cannot explain the game plan back to you, the film session missed.",
    "Every staff knows the player who looks great in warmups and disappears in the second half.",
    "Offensive sets are only as good as the reads your guys actually make under pressure.",
    "The best player development staffs coach the same thing 3 different ways until it sticks.",
    "You can see a team's culture in how they execute after a bad call. That is the real film.",
    "A roster is not a lineup. The best coaches know which 3 guys change the game when it tightens.",
  ],
  nfl: [
    "Football staffs do not need more film. They need clearer corrections.",
    "The fastest football improvement usually comes from one rep and one coaching point.",
    "Good football prep looks boring right up until chaos hits.",
    "Down, distance, and field position usually expose the real coaching problems.",
    "The best sideline adjustments start before the coordinator says a word.",
    "Football analytics matter when they sharpen decisions, not when they decorate reports.",
    "A game plan survives until the second drive. The adjustments after that are the real coaching.",
    "Red zone offense is not about scheme. It is about which coach taught the details that week.",
    "The third quarter tells you more about preparation than the first half ever will.",
    "Special teams are where coaching gaps show up first. Everyone knows it, few fix it.",
    "Playbooks get thicker every year. The best staffs keep getting simpler.",
    "A bad rep on Wednesday usually shows up as a bad rep on Sunday. That is not a coincidence.",
    "Film rooms full of analysts do not help if the message to players is still unclear.",
    "Every coordinator has a play they love. The best ones know when to stop calling it.",
    "The sideline headset is the loneliest place in sports when the defense gives up a third and long.",
    "Blocking assignments do not break down because of talent. They break down because of teaching.",
  ],
  mlb: [
    "Baseball review gets noisy fast when every inning makes the cut.",
    "The best baseball teaching usually starts with one sequence, not a full lecture.",
    "Good baseball prep is usually just clean matchup thinking.",
    "Leverage swings usually tell you more than the final line does.",
    "The best baseball adjustments usually happen before panic shows up.",
    "Baseball data is useful when it survives the trip from spreadsheet to dugout.",
    "A pitching staff is only as good as the conversation between starts, not just the bullpen phone.",
    "Lineup construction matters less than pitch sequencing in the at-bats that actually change the game.",
    "The best baseball coaches do not overload hitters with data. They give them one thing to look for.",
    "Defensive positioning is just math until someone misreads the ball. Then it is coaching.",
    "Spring training tells you who prepared and who just showed up to get loose.",
    "Bullpen management is easy on paper. It gets real when your best arm is tired and the lineup turns over.",
    "The best base running is invisible. You only notice it when it is bad.",
    "Scouting reports are only useful when players actually use them in the box.",
    "A bench coach sees more than anyone in the dugout. The best managers know when to listen.",
    "The difference between a slump and a mechanical issue is usually one honest video session.",
  ],
  soccer: [
    "Most match review fails because it tries to coach every phase at once.",
    "The best soccer coaching point is usually one sequence and one tactical fix.",
    "Soccer prep gets easier when the notes are clearer than the match chaos.",
    "Territory and defensive balance usually matter before the scoreline catches up.",
    "Good match adjustments usually start with shape, not speeches.",
    "Soccer analytics only matter if they survive contact with real coaching.",
    "A halftime talk is 3 minutes. The best ones change the next 45. The worst ones just fill time.",
    "Pressing is a system, not an attitude. The teams that tire in the second half usually never had one.",
    "Set piece coaching is the easiest way to win and the last thing most staffs actually prepare.",
    "Transition moments tell you everything about who is coached and who is just athletic.",
    "The best defensive coaches do not scream about effort. They fix the shape before it breaks.",
    "Possession means nothing without intent. Passing for the sake of passing is just resting on the ball.",
    "The real tactical battle happens in the first 15 minutes. The rest is adjustments.",
    "A substitute changes the game only when the instruction is clear. Otherwise it is just fresh legs.",
    "Youth development is patience with a plan. Most clubs have the patience but skip the plan.",
    "Midfield control is not about having the ball. It is about controlling where the opponent can play.",
  ],
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
  /** Top-performing post texts to use as style examples. */
  winningPostTexts?: string[];
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

/**
 * Load the system prompt for the current campaign with a 3-level fallback:
 * 1. campaigns/<slug>/system_prompt.txt  (per-campaign override)
 * 2. apps/social-bot-engine/prompts/<dataSource>_system_prompt.txt  (data-source default)
 * 3. apps/social-bot-engine/prompts/system_prompt.txt  (global default)
 * All loaded prompts get {brand_name} / {brand_website} replacement.
 */
function loadCampaignSystemPrompt(): string {
  const slug = process.env.CAMPAIGN?.trim();
  const dataSource = DATA_SOURCE;

  // 1. Per-campaign prompt
  if (slug) {
    const campaignPath = resolve(CAMPAIGNS_DIR, slug, "system_prompt.txt");
    if (existsSync(campaignPath)) {
      return readFileSync(campaignPath, "utf-8")
        .trim()
        .replace(/\{brand_name\}/g, BRAND_NAME)
        .replace(/\{brand_website\}/g, BRAND_WEBSITE);
    }
  }

  // 2. Data-source-specific prompt (e.g. angles_only_system_prompt.txt)
  if (dataSource !== "sports") {
    const dsPath = resolve(PROMPTS_DIR, `${dataSource}_system_prompt.txt`);
    if (existsSync(dsPath)) {
      return readFileSync(dsPath, "utf-8")
        .trim()
        .replace(/\{brand_name\}/g, BRAND_NAME)
        .replace(/\{brand_website\}/g, BRAND_WEBSITE);
    }
  }

  // 3. Global default
  const defaultPath = resolve(PROMPTS_DIR, "system_prompt.txt");
  if (!existsSync(defaultPath)) throw new Error(`System prompt not found: ${defaultPath}`);
  return readFileSync(defaultPath, "utf-8")
    .trim()
    .replace(/\{brand_name\}/g, BRAND_NAME)
    .replace(/\{brand_website\}/g, BRAND_WEBSITE);
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

/** Get the current month name for time-aware fallbacks. */
function currentMonthContext(): string {
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return months[new Date().getMonth()];
}

/** Get a seasonal context string for time-aware fallback variation. */
function seasonalContext(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "Spring season is here.";
  if (month >= 5 && month <= 7) return "Midseason grind.";
  if (month >= 8 && month <= 10) return "Fall ball is in full swing.";
  return "Offseason prep matters.";
}

async function requestTweet(client: OpenAI, system: string, userMessage: string): Promise<string | null> {
  const resp = await client.chat.completions.create({
    model: ACTIVE_LLM_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMessage },
    ],
    max_tokens: 90,
    temperature: 0.92,
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
  const system = loadCampaignSystemPrompt();
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
  const winnerBlock = (options.winningPostTexts?.length ?? 0) > 0
    ? `\nPosts that performed well recently — learn from their style and rhythm, but do NOT copy them:\n${options.winningPostTexts!.slice(0, 3).map((t) => `- "${t}"`).join("\n")}`
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
  userMessage += `${newsBlock}${winnerBlock}\nReserve space for a short tracking link appended automatically. Keep the body under ${maxBodyLength} characters.`;

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
      if (attempt > 0) userMessage += strictFollowup(hook.label);
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
            attemptRecord.failedChecks.push("length");
            attemptRecord.rejectionReason = "over_length";
            attempts.push(attemptRecord);
            userMessage += COMPRESSION_FOLLOWUP;
            continue;
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
            !referencesHeadline(content, options.newsContext.selectedArticle.title, sport) &&
            attempt < maxRetries - 1
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
            userMessage += weakOpenerFollowup(hook.label);
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

function isDuplicateOfRecent(candidate: string, recentTexts: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const cNorm = norm(candidate);
  const cLead = cNorm.slice(0, 70);
  for (const t of recentTexts) {
    if (norm(t) === cNorm) return true;
    if (norm(t).slice(0, 70) === cLead) return true;
  }
  return false;
}

export interface GeneratePostAnglesOnlyOptions {
  angle: string;
  date?: string;
  recentTweets?: string[];
  reserveChars?: number;
}

/** Post formats for angles_only (e.g. canopy). Rotated by day to avoid same structure every time. */
const ANGLES_ONLY_POST_FORMATS = [
  "TENSION",
  "MICRO-STORY",
  "CONTRARIAN",
  "SPECIFIC DETAIL",
  "QUESTION",
  "BEHIND-THE-SCENES",
] as const;

function getPostFormatForDate(date: Date): (typeof ANGLES_ONLY_POST_FORMATS)[number] {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000)
  );
  return ANGLES_ONLY_POST_FORMATS[dayOfYear % ANGLES_ONLY_POST_FORMATS.length];
}

/** Context lines for angles_only user message; rotated by day. Covers seasonality, events, target audiences, industry. */
const ANGLES_ONLY_CONTEXT_SNIPPETS = [
  "Event season is ramping up. A lot of teams and vendors are realizing they need to order now for spring events.",
  "Summer events are in full swing. Last-minute orders are coming in from people who waited too long.",
  "Fall festival and game day season. Lead times matter when something fails right before the event.",
  "Trade show season. Booth visibility is the game — the tent is the first thing people see from 50 feet away.",
  "Farmers markets and outdoor vendor events are booking. Setup and sizing are top of mind for planners.",
  "Wind and weather have been rough at a few outdoor events. Durability and frame quality are what people are asking about.",
  "Spring games and tournaments are on the calendar. Full-color branding and quick turnaround are the main asks.",
  "Vendors are comparing plain tents vs branded. Visibility from a distance is the conversation.",
  "Rush orders and replacement canopies are spiking. Something failed or someone waited — either way, lead time is the constraint.",
  "Real estate teams are prepping for open house season. Curb appeal and branded presence are top of mind.",
  "Sports teams and leagues are ordering for game day. Sideline visibility and team branding are the main asks.",
  "Corporate event and trade show calendars are filling. Booth design and lead capture are the conversation.",
  "Local parades and community events are on the calendar. Stand-out visibility for small businesses matters.",
  "Event marketing and experiential marketing are trending again. Brands that show up in person are winning.",
  "Festival and outdoor vendor season. Full-color canopies and quick turnaround are what planners are asking about.",
  "Car dealerships and marinas are planning tent events. Branded presence and durability are the main asks.",
  "Nonprofits and community orgs are booking events. Affordable, durable branding that reads from a distance.",
];

function getContextForAnglesOnly(date: Date): string {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000)
  );
  return ANGLES_ONLY_CONTEXT_SNIPPETS[dayOfYear % ANGLES_ONLY_CONTEXT_SNIPPETS.length];
}

export function getAnglesOnlyPostFormatForDate(date: Date): (typeof ANGLES_ONLY_POST_FORMATS)[number] {
  return getPostFormatForDate(date);
}

export function getAnglesOnlyContextForDate(date: Date): string {
  return getContextForAnglesOnly(date);
}

export interface BuildAnglesOnlyPromptOptions {
  angle: string;
  date?: string;
  recentTweets?: string[];
  reserveChars?: number;
}

export function buildAnglesOnlyPromptInput(options: BuildAnglesOnlyPromptOptions): {
  system: string;
  format: (typeof ANGLES_ONLY_POST_FORMATS)[number];
  context: string;
  pillarData: ReturnType<typeof loadPillarForAngle>;
  userMessage: string;
  maxBodyLength: number;
  date: Date;
  dateStr: string;
} {
  const { angle, date: dateStr = new Date().toISOString().slice(0, 10), recentTweets = [], reserveChars = 0 } = options;
  const date = new Date(dateStr + "T12:00:00Z");
  const maxBodyLength = Math.max(180, MAX_POST_LEN - Math.max(0, reserveChars));
  const system = loadCampaignSystemPrompt();
  const format = getPostFormatForDate(date);
  const context = getContextForAnglesOnly(date);
  const pillarData = loadPillarForAngle(angle, date);
  const avoidBlock =
    recentTweets.length > 0
      ? `\nDo NOT repeat or closely mimic these recent posts:\n${recentTweets.slice(0, 10).map((t) => `- ${t}`).join("\n")}`
      : "";
  const pillarBlock =
    pillarData && pillarData.postIdeas.length > 0
      ? `\nPost ideas for this pillar (use as inspiration, do not list): ${pillarData.postIdeas.join("; ")}.\nTarget audience today: ${pillarData.targetAudience}.`
      : "";
  const userMessage = `Date: ${dateStr}. Focus theme: ${angle}. Post format: ${format}.

Context for this post: ${context}.${pillarBlock}

Write one post in the specified format. If relevant, tie to seasonality or upcoming events. Keep the body under ${maxBodyLength} characters. Output only the post text.${avoidBlock}`;

  return { system, format, context, pillarData, userMessage, maxBodyLength, date, dateStr };
}

function fitAnglesOnlyPostToLimit(
  content: string,
  maxBodyLength: number,
  isQuestionFormat: boolean
): string {
  let text = content.trim();
  const suffix = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;

  if (!isQuestionFormat && (!text.includes(BRAND_NAME) || !text.includes(BRAND_WEBSITE))) {
    if (text.length + suffix.length <= maxBodyLength) return `${text}${suffix}`;

    const roomForBody = Math.max(0, maxBodyLength - suffix.length);
    if (roomForBody <= 3) return suffix.trim().slice(0, maxBodyLength);

    const max = roomForBody - 3;
    const truncated = text.slice(0, max + 1);
    const lastSentence = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf("? "),
      truncated.lastIndexOf("! ")
    );
    const lastSpace = truncated.lastIndexOf(" ");
    const breakAt = lastSentence >= 0 ? lastSentence + 1 : lastSpace >= 0 ? lastSpace : max;
    const brokeAtSentence = lastSentence >= 0;
    text = text.slice(0, breakAt).trim();
    if (!brokeAtSentence) text += "...";
    return `${text}${suffix}`.slice(0, maxBodyLength).trim();
  }

  if (text.length <= maxBodyLength) return text;

  const max = maxBodyLength - 3;
  const truncated = text.slice(0, max + 1);
  const lastSentence = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("? "),
    truncated.lastIndexOf("! ")
  );
  const lastSpace = truncated.lastIndexOf(" ");
  const breakAt = lastSentence >= 0 ? lastSentence + 1 : lastSpace >= 0 ? lastSpace : max;
  const brokeAtSentence = lastSentence >= 0;
  text = text.slice(0, breakAt).trim();
  if (!brokeAtSentence) text += "...";
  return text.slice(0, maxBodyLength).trim();
}

// ── Thread Generation ─────────────────────────────────────────────────────

export interface GenerateThreadOptions {
  sport: string;
  angle: string;
  date?: string;
  recentTweets?: string[];
  iterationGuidance?: string;
}

export interface GenerateThreadResult {
  tweets: string[] | null;
}

const THREAD_SYSTEM_SUPPLEMENT = `You are writing a Twitter/X thread (3-4 connected tweets). Each tweet must be under 280 characters. The first tweet is the hook — it must stop the scroll. Subsequent tweets deliver the coaching insight. The last tweet should include "{brand_name} · {brand_website}". Write like a real coach talking to other coaches. No advice, no CTAs, no sales language. Output each tweet on its own line, separated by ---`;

export async function generateThread(options: GenerateThreadOptions): Promise<GenerateThreadResult> {
  if (!OPENAI_API_KEY) return { tweets: null };
  const system = loadCampaignSystemPrompt() + "\n\n" + THREAD_SYSTEM_SUPPLEMENT
    .replace(/\{brand_name\}/g, BRAND_NAME)
    .replace(/\{brand_website\}/g, BRAND_WEBSITE);

  const { sport, angle, date = new Date().toISOString().slice(0, 10), recentTweets = [] } = options;
  const avoidBlock = recentTweets.length > 0
    ? `\nDo NOT repeat these recent posts:\n${recentTweets.slice(0, 6).map((t) => `- ${t}`).join("\n")}`
    : "";
  const iterationBlock = options.iterationGuidance
    ? `\nIteration guidance:\n${options.iterationGuidance}`
    : "";

  const userMessage = `Write a 3-4 tweet thread for the ${sport} coaching audience. Date: ${date}. Theme: ${angle}.

Thread structure:
1. Hook tweet: tension, hard truth, or counterintuitive observation. Must earn the scroll-stop.
2-3. Deliver the insight with specifics. Scene-based, not generic.
4. Close with a coaching truth and light brand mention (${BRAND_NAME} · ${BRAND_WEBSITE}).

Each tweet must be under 280 characters. Separate tweets with ---${avoidBlock}${iterationBlock}`;

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  const client = new OpenAI(clientOptions);

  try {
    const resp = await client.chat.completions.create({
      model: ACTIVE_LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      max_tokens: 400,
      temperature: 0.92,
    });

    const raw = resp.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) return { tweets: null };

    const tweets = raw.split(/---+/).map((t) => t.trim()).filter((t) => t.length > 0 && t.length <= 280);
    if (tweets.length < 2) return { tweets: null };

    // Ensure brand mention on last tweet
    const last = tweets[tweets.length - 1];
    if (!last.includes(BRAND_NAME) && !last.includes(BRAND_WEBSITE)) {
      const suffix = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;
      if (last.length + suffix.length <= 280) {
        tweets[tweets.length - 1] = last + suffix;
      }
    }

    return { tweets: tweets.slice(0, 4) };
  } catch (err) {
    console.warn("Thread generation failed:", err);
    return { tweets: null };
  }
}

/** Determine if today is a thread day (1-2x per week: Wednesday and Saturday). */
export function isThreadDay(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 3 || day === 6; // Wednesday or Saturday
}

export function normalizeAnglesOnlyPostForLimit(
  content: string,
  maxBodyLength: number,
  format: (typeof ANGLES_ONLY_POST_FORMATS)[number]
): string {
  return fitAnglesOnlyPostToLimit(content, maxBodyLength, format === "QUESTION");
}

/**
 * Generate a single post for campaigns with dataSource "angles_only" (e.g. canopy).
 * Uses campaign system prompt, rotating angle, rotating post format, and rotating context.
 */
export async function generatePostAnglesOnly(
  options: GeneratePostAnglesOnlyOptions
): Promise<{ text: string | null }> {
  if (!OPENAI_API_KEY) return { text: null };
  const { angle } = options;
  const { system, format, userMessage, maxBodyLength } = buildAnglesOnlyPromptInput(options);

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  const client = new OpenAI(clientOptions);
  const raw = await requestTweet(client, system, userMessage);
  if (!raw) return { text: null };
  const content = normalizeAnglesOnlyPostForLimit(cleanResponse(raw), maxBodyLength, format);
  return { text: content };
}

export function fillFallbackTemplate(
  sport: string,
  _fetchedData: FetchedData,
  options: { reserveChars?: number; angle?: string; templateIndex?: number } = {}
): string {
  const sportKey = sport.toLowerCase();
  const templates = FALLBACK_TEMPLATES[sportKey] ?? FALLBACK_TEMPLATES.default;
  const index = options.templateIndex ?? Math.floor(Math.random() * templates.length);
  const body = templates[index % templates.length];
  const brandSuffix = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;
  const reservedChars = Math.max(0, options.reserveChars ?? 0);
  const maxLen = Math.max(0, MAX_POST_LEN - reservedChars);
  const base = `${body}${brandSuffix}`;

  // Try to add a hashtag if there's room
  const hashtag = pickHashtags(sport, maxLen - base.length);
  let text = hashtag ? `${base} ${hashtag}`.trim() : base.trim();
  if (text.length > maxLen) {
    text = base.trim().slice(0, maxLen);
  }
  return text.slice(0, maxLen);
}

export function pickNonDuplicateFallback(
  sport: string,
  fetchedData: FetchedData,
  recentTexts: string[],
  options: { reserveChars?: number; angle?: string } = {}
): string | null {
  const sportKey = sport.toLowerCase();
  const templates = FALLBACK_TEMPLATES[sportKey] ?? FALLBACK_TEMPLATES.default;

  // Shuffle indices to try templates in random order
  const indices = Array.from({ length: templates.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  for (const index of indices) {
    const candidate = fillFallbackTemplate(sport, fetchedData, { ...options, templateIndex: index });
    if (!isDuplicateOfRecent(candidate, recentTexts)) return candidate;
  }

  // All templates are duplicates — return null to signal skip
  return null;
}
