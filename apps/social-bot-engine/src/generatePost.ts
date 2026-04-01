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
import { BRAND_NAME, BRAND_WEBSITE } from "./validate.js";

export const BRAND_SUFFIX = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;

export const BANNED_AD_PHRASES = [
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

export const MARKETING_TERMS = ["actionable", "seamless", "effortlessly", "powerful", "maximize", "transform", "organized"];

export const REPETITIVE_PHRASE_PATTERNS = [
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

export const INSTRUCTIONAL_PATTERNS = [
  /\bcoaches need to\b/i,
  /\byou need to\b/i,
  /\brecord your thoughts\b/i,
  /\bdocument your thoughts\b/i,
  /\bmake every word count\b/i,
  /\buse your voice\b/i,
  /\bafter every game\b/i,
  /\bnow'?s the time to\b/i,
];

export const TITLE_STOPWORDS = new Set([
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

/**
 * Load the system prompt for the current campaign with a 3-level fallback:
 * 1. campaigns/<slug>/system_prompt.txt  (per-campaign override)
 * 2. apps/social-bot-engine/prompts/<dataSource>_system_prompt.txt  (data-source default)
 * 3. apps/social-bot-engine/prompts/system_prompt.txt  (global default)
 * All loaded prompts get {brand_name} / {brand_website} replacement.
 */
export function loadCampaignSystemPrompt(): string {
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

/** Strip quotes, markdown fences, and "Tweet:"-style prefixes so validation doesn't fail on formatting. */
export function cleanResponse(raw: string): string {
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

export function isDuplicateOfRecent(candidate: string, recentTexts: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const cNorm = norm(candidate);
  const cLead = cNorm.slice(0, 70);
  for (const t of recentTexts) {
    if (norm(t) === cNorm) return true;
    if (norm(t).slice(0, 70) === cLead) return true;
  }
  return false;
}

export function createLLMClient(): OpenAI {
  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  return new OpenAI(clientOptions);
}

export async function requestTweet(client: OpenAI, system: string, userMessage: string): Promise<string | null> {
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

export async function compressTweetToFit(
  client: OpenAI,
  system: string,
  original: string,
  maxBodyLength: number
): Promise<string | null> {
  const COMPRESSION_FOLLOWUP =
    ` Compress the post you just wrote so it fits the character limit. Keep the same hook, remove filler, keep "postgame AI" and "getpostgame.ai", and reply with only the shortened post.`;
  const shortened = await requestTweet(
    client,
    system,
    `${COMPRESSION_FOLLOWUP}\nLimit: ${maxBodyLength} characters.\nTweet:\n${original}`
  );
  return shortened && shortened.length <= maxBodyLength ? shortened : null;
}

export function countOccurrences(text: string, needle: string): number {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(escaped, "gi"));
  return matches?.length ?? 0;
}

export function soundsLikeAd(text: string): boolean {
  const normalized = text.toLowerCase();
  if (BANNED_AD_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  const marketingHits = MARKETING_TERMS.filter((term) => normalized.includes(term)).length;
  if (marketingHits >= 2) return true;
  if (countOccurrences(text, BRAND_NAME) > 1) return true;
  return false;
}

export function extractHeadlineTerms(title: string, sport: string): string[] {
  return title
    .replace(/['']/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 4)
    .filter((token) => !TITLE_STOPWORDS.has(token))
    .filter((token) => token !== sport.toLowerCase())
    .slice(0, 6);
}

export function referencesHeadline(text: string, title: string, sport: string): boolean {
  const normalized = text.toLowerCase();
  const terms = extractHeadlineTerms(title, sport);
  if (terms.length === 0) return true;
  return terms.some((term) => normalized.includes(term));
}

/** Get the current month name for time-aware fallbacks. */
export function currentMonthContext(): string {
  const months = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  return months[new Date().getMonth()];
}

/** Get a seasonal context string for time-aware fallback variation. */
export function seasonalContext(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "Spring season is here.";
  if (month >= 5 && month <= 7) return "Midseason grind.";
  if (month >= 8 && month <= 10) return "Fall ball is in full swing.";
  return "Offseason prep matters.";
}

export const SPORT_HASHTAG_POOLS: Record<string, string[]> = {
  nba: ["#CoachingBasketball", "#HoopsFilm", "#NBACoaching", "#BasketballIQ", "#CourtVision", "#HoopsDev", "#BallerCoach"],
  nfl: ["#CoachingFootball", "#FootballFilm", "#NFLCoaching", "#GridironIQ", "#FridayNightLights", "#FootballDev", "#XsAndOs"],
  mlb: ["#CoachingBaseball", "#BaseballFilm", "#MLBCoaching", "#DiamondIQ", "#BaseballDev", "#DugoutTalk"],
  soccer: ["#CoachingSoccer", "#SoccerFilm", "#FootballCoaching", "#TacticalAnalysis", "#SoccerDev", "#PitchIQ", "#BeautifulGame"],
  default: ["#CoachingTips", "#FilmReview", "#CoachLife", "#SportsCoaching", "#GamePrep"],
};

/** Pick 1-2 random hashtags for the given sport, respecting the character budget. */
export function pickHashtags(sport: string, remainingChars: number): string {
  const pool = SPORT_HASHTAG_POOLS[sport.toLowerCase()] ?? SPORT_HASHTAG_POOLS.default;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const count = Math.random() < 0.5 ? 1 : 2;
  const selected = shuffled.slice(0, count);
  const hashtags = selected.join(" ");
  if (hashtags.length + 1 > remainingChars) {
    if (selected[0] && selected[0].length + 1 <= remainingChars) return selected[0];
    return "";
  }
  return hashtags;
}

export const FALLBACK_TEMPLATES: Record<string, string[]> = {
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

export const USER_MESSAGE_TEMPLATE = `Context: this post is for the {sport} coaching audience. Date: {date}. Focus theme: {angle}. Frame: {frame_label}. Hook structure: {hook_label}. Emotional target: {emotion_target}.

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
13. Optimize for replies. The best posts make coaches want to respond with their own experience or push back on a claim. Leave a tension unresolved, state something debatable, or surface a dilemma coaches have strong opinions about. A post that starts a conversation is worth 10 posts that get silently liked.

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

/** Post formats for angles_only. Rotated by day to avoid same structure every time. */
export const ANGLES_ONLY_POST_FORMATS = [
  "TENSION",
  "MICRO-STORY",
  "CONTRARIAN",
  "SPECIFIC DETAIL",
  "BEHIND-THE-SCENES",
] as const;

export function getAnglesOnlyPostFormatForDate(date: Date): (typeof ANGLES_ONLY_POST_FORMATS)[number] {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000)
  );
  return ANGLES_ONLY_POST_FORMATS[dayOfYear % ANGLES_ONLY_POST_FORMATS.length];
}

/** Context lines for angles_only user message; rotated by day. */
export const ANGLES_ONLY_CONTEXT_SNIPPETS = [
  "Utah event season is waking up. Vendors are figuring out which setups still feel current and which ones still look like last year.",
  "Saturday market people can spot a serious booth before they are close enough to read the sign.",
  "Spring and summer event rows always expose the same thing: some booths look intentional and some look improvised.",
  "The first hour before an event opens says a lot about how the whole day is going to go.",
  "Farmers markets, maker markets, and community festivals are as much about vibe as they are about product.",
  "Wind is back in the conversation. Outdoor events are the fastest way to find out whether a setup actually looks solid.",
  "Utah fairs, vendor markets, and pop-up events create the same scramble every season: everyone remembers their booth matters at once.",
  "In expo halls and outdoor rows alike, people decide whether a booth feels legit long before they start asking questions.",
  "Local event culture matters. The account should sound like it knows the scene, not like it is selling into it from the outside.",
  "A lot of booth feedback is silent. People do not explain why one setup feels sharper. They just feel it.",
  "Community events reward brands that look like they belong there, not brands that feel dropped in from nowhere.",
  "The best event content sounds like a vendor friend with taste, not a company trying to close.",
  "Some setup problems are budget problems. A surprising number are just editing problems.",
  "Trade show aisles and market rows have one thing in common: first impressions happen fast and they are mostly visual.",
  "A booth can feel expensive without feeling thoughtful, and thoughtful without feeling expensive. That tension is interesting.",
  "Good event brands do not just show products. They create a little world people want to step into.",
  "Outdoor event season always creates stories: rushed setups, weather pivots, lucky saves, and the booth that somehow looked dialed anyway.",
];

export function getAnglesOnlyContextForDate(date: Date): string {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000)
  );
  return ANGLES_ONLY_CONTEXT_SNIPPETS[dayOfYear % ANGLES_ONLY_CONTEXT_SNIPPETS.length];
}

export const CANOPY_GENERIC_PHRASES = [
  /\bstand out\b/i,
  /\bmake an impact\b/i,
  /\binviting and sturdy\b/i,
  /\bpremium quality\b/i,
  /\bready to\b/i,
  /\bdon'?t scrimp\b/i,
  /\bturn heads\b/i,
  /\beveryone talks about\b/i,
  /\bthe whole conversation\b/i,
  /\bwork as hard as you do\b/i,
  /\bwhy blend in\b/i,
  /\bgrab(?:bing)? all the attention\b/i,
  /\bgrab attention\b/i,
  /\bcatch the eye\b/i,
  /\bmake your message visible\b/i,
  /\bnot a myth\b/i,
  /\bsmart buying\b/i,
  /\bactual feet stopping\b/i,
  /\bthe booth everyone remembers\b/i,
  /\bright attention\b/i,
  /\bripple dance\b/i,
  /\breal mvps?\b/i,
  /\bpanic early\b/i,
  /\bmake it count\b/i,
  /\byour first impression\b/i,
  /\btells a story\b/i,
  /\bdeserves better\b/i,
  /\bbooth impression hack\b/i,
  /\bbefore you even say a word\b/i,
  /\bdoes the talking\b/i,
  /\bvibe check\b/i,
  /\bvibes\b/i,
  /\bwinging it\b/i,
  /\bremember,\b/i,
  /\bsilent reviewer\b/i,
  /\bstory at a glance\b/i,
  /\btells everyone your story\b/i,
  /\bfirst impression\b/i,
  /\bisn't a checklist\b/i,
  /\bwhether you notice it or not\b/i,
];

export const CANOPY_HARD_CTA_PATTERNS = [
  /\bdm us\b/i,
  /\bmessage us\b/i,
  /\bget a quote\b/i,
  /\bshop now\b/i,
  /\blink in bio\b/i,
  /\bcontact us\b/i,
];

export const CANOPY_MOTIVATIONAL_PATTERNS = [
  /\bmake it count\b/i,
  /\bkeep going\b/i,
  /\byou built a whole business\b/i,
  /\bready for your next event\b/i,
  /\bthis is what standing out looks like\b/i,
];

export const CANOPY_CORPORATE_PATTERNS = [
  /\bpremium commercial\b/i,
  /\bbrand presence\b/i,
  /\bmaximize\b/i,
  /\bvisibility problem\b/i,
  /\bideal for\b/i,
  /\bsolution\b/i,
  /\bcurated expertise\b/i,
  /\bfluently\b/i,
];

export const CANOPY_FIELD_TERMS = [
  /\baisle\b/i,
  /\bparking lot\b/i,
  /\bpaid spot\b/i,
  /\bvalance\b/i,
  /\bframe\b/i,
  /\bdrooping vinyl\b/i,
  /\brush order\b/i,
  /\breplacement order\b/i,
  /\bsetup window\b/i,
  /\bcurb\b/i,
  /\bcurbside\b/i,
  /\bwind\b/i,
  /\bbooth\b/i,
  /\btent\b/i,
  /\bfeather flag\b/i,
  /\bbanner\b/i,
  /\bprint\b/i,
];

// Re-exports for backwards compatibility
export {
  generatePost,
  fillFallbackTemplate,
  pickNonDuplicateFallback,
  generateThread,
  isThreadDay,
} from "./generateSportsPost.js";
export type {
  GeneratePostOptions,
  GeneratePostAttempt,
  GeneratePostResult,
  GenerateThreadOptions,
  GenerateThreadResult,
} from "./generateSportsPost.js";
export {
  generatePostAnglesOnly,
  generateCanopyCandidateBatch,
  judgeCanopyCandidates,
  buildAnglesOnlyPromptInput,
  normalizeAnglesOnlyPostForLimit,
} from "./generateAnglesOnly.js";
export type {
  GeneratePostAnglesOnlyOptions,
  GenerateCanopyCandidateBatchOptions,
  BuildAnglesOnlyPromptOptions,
} from "./generateAnglesOnly.js";
