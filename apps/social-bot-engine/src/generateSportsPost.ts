import { OPENAI_API_KEY, ACTIVE_LLM_MODEL, MAX_POST_LEN } from "./config.js";
import type { ContentDecision, RecentContentDecision } from "./contentArchitecture.js";
import { FRAME_DEFINITIONS, HOOK_DEFINITIONS } from "./contentArchitecture.js";
import { evaluatePrePublishChecks, getOpeningPattern } from "./contentHeuristics.js";
import type { FetchedData } from "./fetchData.js";
import type { NewsContext } from "./fetchNews.js";
import { BRAND_NAME, BRAND_WEBSITE } from "./validate.js";
import type { Persona } from "./personaEngine.js";
import { composeSystemPromptWithPersona } from "./personaEngine.js";
import type { ContentTypeId } from "./contentTypeTemplates.js";
import { buildContentTypeInstruction } from "./contentTypeTemplates.js";
import {
  loadCampaignSystemPrompt,
  cleanResponse,
  requestTweet,
  compressTweetToFit,
  soundsLikeAd,
  isDuplicateOfRecent,
  referencesHeadline,
  createLLMClient,
  REPETITIVE_PHRASE_PATTERNS,
  INSTRUCTIONAL_PATTERNS,
  BRAND_SUFFIX,
  USER_MESSAGE_TEMPLATE,
  FALLBACK_TEMPLATES,
  SPORT_HASHTAG_POOLS,
  pickHashtags,
} from "./generatePost.js";

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

function selectArchetype(sport: string, date: string, preferNews: boolean): (typeof VIRAL_ARCHETYPES)[number] {
  if (preferNews) return "news_take";
  const seed = `${sport}:${date}`;
  const sum = [...seed].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return VIRAL_ARCHETYPES[sum % VIRAL_ARCHETYPES.length];
}

function usesRepetitivePhraseFamily(text: string): boolean {
  return REPETITIVE_PHRASE_PATTERNS.some((pattern) => pattern.test(text));
}

function soundsInstructional(text: string): boolean {
  return INSTRUCTIONAL_PATTERNS.some((pattern) => pattern.test(text));
}

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
  persona?: Persona;
  contentTypeId?: ContentTypeId;
  brandMentionAllowed?: boolean;
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

export async function generatePost(
  fetchedData: FetchedData,
  maxRetries = 3,
  options: GeneratePostOptions = {}
): Promise<GeneratePostResult> {
  if (!OPENAI_API_KEY) return { text: null, attempts: [] };
  const baseSystem = loadCampaignSystemPrompt();
  const system = options?.persona
    ? composeSystemPromptWithPersona(baseSystem, options.persona)
    : baseSystem;
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

  const client = createLLMClient();

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
          const shouldAppendBrand = !options?.persona || options?.brandMentionAllowed !== false;
          if (shouldAppendBrand) {
            const hasName = content.includes(BRAND_NAME);
            const hasWebsite = content.includes(BRAND_WEBSITE);
            if ((!hasName || !hasWebsite) && content.length <= MAX_POST_LEN - BRAND_SUFFIX.length) {
              content = `${content.trim()}${BRAND_SUFFIX}`;
            }
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

  const client = createLLMClient();

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
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }

  for (const index of indices) {
    const candidate = fillFallbackTemplate(sport, fetchedData, { ...options, templateIndex: index });
    if (!isDuplicateOfRecent(candidate, recentTexts)) return candidate;
  }

  // All templates are duplicates — return null to signal skip
  return null;
}
