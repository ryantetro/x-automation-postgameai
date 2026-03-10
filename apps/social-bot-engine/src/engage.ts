/**
 * Engagement engine: search for relevant tweets, like, reply, and follow
 * in the target coaching community. All actions are gated behind ENGAGE_ENABLED
 * and gracefully degrade when the X API tier doesn't support the required endpoints.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TwitterApi } from "twitter-api-v2";
import OpenAI from "openai";
import {
  OPENAI_API_KEY,
  USE_OPENAI_API,
  LLM_BASE_URL,
  ACTIVE_LLM_MODEL,
  BRAND_NAME,
  STATE_DIR,
} from "./config.js";
import { getXClient } from "./postToX.js";

// ── Config ──────────────────────────────────────────────────────────────────

function getEnv(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim();
}

function getIntEnv(key: string, fallback: number): number {
  const v = Number.parseInt(getEnv(key, String(fallback)), 10);
  return Number.isFinite(v) ? v : fallback;
}

export const ENGAGE_ENABLED = !["false", "0", "no"].includes(getEnv("ENGAGE_ENABLED", "false").toLowerCase());
const ENGAGE_SEARCH_KEYWORDS = getEnv("ENGAGE_SEARCH_KEYWORDS")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const ENGAGE_MAX_LIKES = getIntEnv("ENGAGE_MAX_LIKES", 12);
const ENGAGE_MAX_REPLIES = getIntEnv("ENGAGE_MAX_REPLIES", 4);
const ENGAGE_MAX_FOLLOWS = getIntEnv("ENGAGE_MAX_FOLLOWS", 2);
const ENGAGE_STATE_FILE = resolve(STATE_DIR, "engage-state.json");

// ── State ───────────────────────────────────────────────────────────────────

interface EngageState {
  lastRunAt: string;
  likedTweetIds: string[];
  repliedTweetIds: string[];
  followedUserIds: string[];
  dailyCounts: {
    date: string;
    likes: number;
    replies: number;
    follows: number;
  };
}

function defaultState(): EngageState {
  return {
    lastRunAt: new Date().toISOString(),
    likedTweetIds: [],
    repliedTweetIds: [],
    followedUserIds: [],
    dailyCounts: { date: new Date().toISOString().slice(0, 10), likes: 0, replies: 0, follows: 0 },
  };
}

function loadState(): EngageState {
  if (!existsSync(ENGAGE_STATE_FILE)) return defaultState();
  try {
    return JSON.parse(readFileSync(ENGAGE_STATE_FILE, "utf-8")) as EngageState;
  } catch {
    return defaultState();
  }
}

function saveState(state: EngageState): void {
  mkdirSync(dirname(ENGAGE_STATE_FILE), { recursive: true });
  writeFileSync(ENGAGE_STATE_FILE, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Prune state arrays to keep only last 500 entries and reset daily counts if date rolled. */
function pruneState(state: EngageState): void {
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyCounts.date !== today) {
    state.dailyCounts = { date: today, likes: 0, replies: 0, follows: 0 };
  }
  state.likedTweetIds = state.likedTweetIds.slice(-500);
  state.repliedTweetIds = state.repliedTweetIds.slice(-500);
  state.followedUserIds = state.followedUserIds.slice(-500);
}

// ── Search ──────────────────────────────────────────────────────────────────

interface SearchedTweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername?: string;
}

async function searchTweets(client: TwitterApi, keywords: string[], maxResults = 30): Promise<SearchedTweet[]> {
  const query = keywords.map((kw) => `"${kw}"`).join(" OR ");
  try {
    const result = await client.v2.search(query, {
      max_results: Math.min(maxResults, 100),
      "tweet.fields": "author_id,text",
      expansions: "author_id",
      "user.fields": "username",
    });
    const users = new Map<string, string>();
    if (result.includes?.users) {
      for (const u of result.includes.users) {
        users.set(u.id, u.username);
      }
    }
    const tweets: SearchedTweet[] = [];
    for (const tweet of result.data?.data ?? []) {
      tweets.push({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id ?? "",
        authorUsername: users.get(tweet.author_id ?? ""),
      });
    }
    return tweets;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("CreditsDepleted") || msg.includes("Not authorized")) {
      console.warn("Search endpoint not available on current API tier. Skipping engagement search.");
      return [];
    }
    console.warn("Tweet search failed:", msg);
    return [];
  }
}

// ── Like ────────────────────────────────────────────────────────────────────

async function likeTweet(client: TwitterApi, tweetId: string): Promise<boolean> {
  try {
    const me = await client.v2.me();
    await client.v2.like(me.data.id, tweetId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("Not authorized")) {
      console.warn("Like endpoint not available on current API tier.");
      return false;
    }
    console.warn(`Failed to like tweet ${tweetId}:`, msg);
    return false;
  }
}

// ── Reply ───────────────────────────────────────────────────────────────────

async function generateReply(tweetText: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;
  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey: OPENAI_API_KEY };
  if (!USE_OPENAI_API && LLM_BASE_URL) clientOptions.baseURL = LLM_BASE_URL;
  const client = new OpenAI(clientOptions);

  const resp = await client.chat.completions.create({
    model: ACTIVE_LLM_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a knowledgeable coaching analyst. Write a brief, genuine reply to a tweet about coaching or sports. Be conversational, add value with an insight or agreement, and never promote anything. Keep it under 200 characters. Do not use hashtags. Sound like a real coach, not a brand.`,
      },
      {
        role: "user",
        content: `Reply to this tweet naturally:\n"${tweetText}"`,
      },
    ],
    max_tokens: 60,
    temperature: 0.9,
  });

  const text = resp.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text || text.length > 280) return null;
  // Strip quotes if the model wraps in quotes
  return text.replace(/^["']|["']$/g, "").trim();
}

async function replyToTweet(client: TwitterApi, tweetId: string, text: string): Promise<boolean> {
  try {
    await client.v2.tweet({ text, reply: { in_reply_to_tweet_id: tweetId } });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Failed to reply to tweet ${tweetId}:`, msg);
    return false;
  }
}

// ── Follow ──────────────────────────────────────────────────────────────────

async function followUser(client: TwitterApi, userId: string): Promise<boolean> {
  try {
    const me = await client.v2.me();
    await client.v2.follow(me.data.id, userId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("403") || msg.includes("Not authorized")) {
      console.warn("Follow endpoint not available on current API tier.");
      return false;
    }
    console.warn(`Failed to follow user ${userId}:`, msg);
    return false;
  }
}

// ── Main Engage Flow ────────────────────────────────────────────────────────

export interface EngageResult {
  searched: number;
  liked: number;
  replied: number;
  followed: number;
  skippedReason?: string;
}

/** Load campaign-specific engage keywords from config.json if available. */
function loadCampaignKeywords(): string[] {
  const slug = process.env.CAMPAIGN?.trim();
  if (!slug) return [];
  const configPath = resolve(process.cwd(), "campaigns", slug, "config.json");
  if (!existsSync(configPath)) return [];
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as { engageKeywords?: string[] };
    return Array.isArray(config.engageKeywords) ? config.engageKeywords : [];
  } catch {
    return [];
  }
}

export async function runEngagement(): Promise<EngageResult> {
  if (!ENGAGE_ENABLED) {
    console.info("Engagement disabled (ENGAGE_ENABLED=false). Skipping.");
    return { searched: 0, liked: 0, replied: 0, followed: 0, skippedReason: "disabled" };
  }

  const client = getXClient();
  if (!client) {
    console.warn("No X client available. Skipping engagement.");
    return { searched: 0, liked: 0, replied: 0, followed: 0, skippedReason: "no_client" };
  }

  const state = loadState();
  pruneState(state);

  const campaignKeywords = loadCampaignKeywords();
  const keywords = [...ENGAGE_SEARCH_KEYWORDS, ...campaignKeywords].filter(Boolean);
  if (keywords.length === 0) {
    console.warn("No engage keywords configured. Set ENGAGE_SEARCH_KEYWORDS or add engageKeywords to campaign config.");
    return { searched: 0, liked: 0, replied: 0, followed: 0, skippedReason: "no_keywords" };
  }

  // Search for relevant tweets
  const tweets = await searchTweets(client, keywords);
  if (tweets.length === 0) {
    console.info("No tweets found for engagement keywords.");
    state.lastRunAt = new Date().toISOString();
    saveState(state);
    return { searched: 0, liked: 0, replied: 0, followed: 0 };
  }

  const likedSet = new Set(state.likedTweetIds);
  const repliedSet = new Set(state.repliedTweetIds);
  const followedSet = new Set(state.followedUserIds);

  let liked = 0;
  let replied = 0;
  let followed = 0;

  // Filter to tweets we haven't already engaged with
  const fresh = tweets.filter((t) => !likedSet.has(t.id));

  // Like tweets
  const likeBudget = Math.max(0, ENGAGE_MAX_LIKES - state.dailyCounts.likes);
  for (const tweet of fresh.slice(0, likeBudget)) {
    const ok = await likeTweet(client, tweet.id);
    if (ok) {
      liked++;
      state.likedTweetIds.push(tweet.id);
      state.dailyCounts.likes++;
    } else if (liked === 0) {
      // If the very first like fails due to API tier, stop trying
      break;
    }
  }

  // Reply to a subset of highly relevant tweets
  const replyBudget = Math.max(0, ENGAGE_MAX_REPLIES - state.dailyCounts.replies);
  const replyable = fresh.filter((t) => !repliedSet.has(t.id) && t.text.length > 30);
  for (const tweet of replyable.slice(0, replyBudget)) {
    const replyText = await generateReply(tweet.text);
    if (!replyText) continue;
    const ok = await replyToTweet(client, tweet.id, replyText);
    if (ok) {
      replied++;
      state.repliedTweetIds.push(tweet.id);
      state.dailyCounts.replies++;
    }
  }

  // Follow a few authors
  const followBudget = Math.max(0, ENGAGE_MAX_FOLLOWS - state.dailyCounts.follows);
  const followable = fresh
    .filter((t) => t.authorId && !followedSet.has(t.authorId))
    .map((t) => t.authorId)
    .filter((id, i, arr) => arr.indexOf(id) === i);
  for (const userId of followable.slice(0, followBudget)) {
    const ok = await followUser(client, userId);
    if (ok) {
      followed++;
      state.followedUserIds.push(userId);
      state.dailyCounts.follows++;
    } else if (followed === 0) {
      break;
    }
  }

  state.lastRunAt = new Date().toISOString();
  saveState(state);

  console.info(`Engagement complete: ${tweets.length} searched, ${liked} liked, ${replied} replied, ${followed} followed`);
  return { searched: tweets.length, liked, replied, followed };
}
