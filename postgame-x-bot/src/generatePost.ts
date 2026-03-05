import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import OpenAI from "openai";
import {
  OPENAI_API_KEY,
  USE_OPENAI_API,
  LLM_BASE_URL,
  ACTIVE_LLM_MODEL,
  PROMPTS_DIR,
  MAX_TWEET_LEN,
} from "./config.js";
import type { FetchedData } from "./fetchData.js";
import { isValidTweet, BRAND_NAME, BRAND_WEBSITE } from "./validate.js";

const BRAND_SUFFIX = ` — ${BRAND_NAME} · ${BRAND_WEBSITE}`;

const USER_MESSAGE_TEMPLATE = `Context: this post is for the {sport} coaching audience. Date: {date}. Focus for this tweet (pick a fact in this theme): {angle}.

Write a tweet that:
1. Leads with a concrete fact: a stat, what research shows, what elite coaches/teams do, or a clear trend. Make it credible and interesting.
2. Then relate that fact to how postgame AI helps with coaching and how it connects to the app—e.g. "postgame AI helps you do exactly that," "that's what postgame AI is built for."
3. End with "postgame AI · getpostgame.ai" and 1–2 hashtags. CRITICAL: Stay under 275 characters—use two short sentences only. Reply with ONLY the tweet. Do not lead with a single game score.
{avoid_block}
{iteration_block}`;

const STRICT_FOLLOWUP =
  ` Your last reply was too long, incomplete, or missing postgame AI / getpostgame.ai. Write a NEW tweet: lead with a fact (stat/research/trend), then relate to how postgame AI helps and connects to the app; 2–3 sentences, under 275 characters; MUST include both "postgame AI" and "getpostgame.ai". Reply with only the tweet text.`;

const AVOID_FOLLOWUP =
  ` Your previous suggestion was too similar to a recent post. Write a DIFFERENT tweet: different fact, different angle. Still lead with a fact, then connect to postgame AI. Under 275 characters. Reply with only the tweet text.`;

export interface GeneratePostOptions {
  /** Recent tweet texts to avoid repeating (for uniqueness). */
  recentTweets?: string[];
  /** Focus/angle for the fact (e.g. film review timing, specific feedback). */
  angle?: string;
  /** Date string for prompt context (e.g. 2026-02-27). */
  date?: string;
  /** Insights from prior analytics to iterate toward winning patterns. */
  iterationGuidance?: string;
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
  const avoidBlock =
    (options.recentTweets?.length ?? 0) > 0
      ? `\nDo NOT repeat or closely mimic these recent tweets:\n${options.recentTweets!.slice(0, 12).map((t) => `- ${t}`).join("\n")}`
      : "";
  const iterationBlock = options.iterationGuidance
    ? `\nIteration guidance from recent tweet analytics (follow these patterns):\n${options.iterationGuidance}`
    : "";
  let userMessage = USER_MESSAGE_TEMPLATE.replace(/\{sport\}/g, sport)
    .replace(/\{date\}/g, date)
    .replace(/\{angle\}/g, angle)
    .replace(/\{avoid_block\}/g, avoidBlock)
    .replace(/\{iteration_block\}/g, iterationBlock);

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  const client = new OpenAI(clientOptions);

  let lastContent: string | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) userMessage += STRICT_FOLLOWUP;
      const resp = await client.chat.completions.create({
        model: ACTIVE_LLM_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMessage },
        ],
        max_tokens: 120,
        temperature: 0.8,
      });
      const choice = resp.choices?.[0];
      const raw = choice?.message?.content?.trim();
      if (raw) {
        let content = cleanResponse(raw);
        lastContent = content;
        if (content) {
          const hasName = content.includes(BRAND_NAME);
          const hasWebsite = content.includes(BRAND_WEBSITE);
          if ((!hasName || !hasWebsite) && content.length <= MAX_TWEET_LEN - BRAND_SUFFIX.length) {
            content = `${content.trim()}${BRAND_SUFFIX}`;
          }
          if (content.length > 280) console.warn(`LLM returned ${content.length} chars (max 280)`);
          if (!content.includes(BRAND_NAME)) console.warn(`LLM response missing ${BRAND_NAME}`);
          if (!content.includes(BRAND_WEBSITE)) console.warn(`LLM response missing ${BRAND_WEBSITE}`);
          return content;
        }
      }
    } catch (err) {
      console.warn(`LLM attempt ${attempt + 1} failed:`, err);
    }
  }
  return lastContent;
}

export function fillFallbackTemplate(sport: string, fetchedData: FetchedData): string {
  let templatePath = resolve(PROMPTS_DIR, "templates", `${sport}_template.txt`);
  if (!existsSync(templatePath)) {
    templatePath = resolve(PROMPTS_DIR, "templates", "nba_template.txt");
  }
  const template = readFileSync(templatePath, "utf-8").trim();
  const date = fetchedData.date ?? "";
  let summary = fetchedData.summary ?? "No games today.";
  const placeholderLen = "{date}".length + "{summary}".length;
  const maxSummaryLen = MAX_TWEET_LEN - template.length - date.length + placeholderLen;
  if (summary.length > maxSummaryLen) {
    summary = summary.slice(0, maxSummaryLen - 3) + "...";
  }
  const topGame = fetchedData.top_game ?? {};
  const filled = template
    .replace("{date}", date)
    .replace("{summary}", summary)
    .replace("{top_game}", typeof topGame === "object" ? JSON.stringify(topGame) : String(topGame));
  return filled.trim().slice(0, MAX_TWEET_LEN);
}
