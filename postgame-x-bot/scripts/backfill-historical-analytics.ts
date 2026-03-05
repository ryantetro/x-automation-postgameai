import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { validateConfig } from "../src/config.js";
import {
  ANALYTICS_STORE_FILE,
  loadAnalyticsStore,
  parseSuccessfulLogTexts,
  pruneStore,
  refreshMetricsForStore,
  saveAnalyticsStore,
  upsertTweetRecord,
} from "../src/analytics.js";
import { getXClient } from "../src/postToX.js";

const LOG_FILE = resolve(process.cwd(), "logs", "posts.log");

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function textSimilarity(a: string, b: string): number {
  const aa = normalizeText(a);
  const bb = normalizeText(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) {
    return Math.min(aa.length, bb.length) / Math.max(aa.length, bb.length);
  }
  const prefixLen = Math.min(aa.length, bb.length, 80);
  let samePrefix = 0;
  for (let i = 0; i < prefixLen; i++) {
    if (aa[i] !== bb[i]) break;
    samePrefix++;
  }
  return samePrefix / Math.max(prefixLen, 1);
}

async function fetchMyRecentTweets(maxPages = 6, pageSize = 100): Promise<Array<Record<string, unknown>>> {
  const client = getXClient();
  if (!client) throw new Error("Missing X OAuth credentials.");

  const me = (await client.v2.get("users/me")) as { data?: { id?: string } };
  const userId = me?.data?.id;
  if (!userId) throw new Error("Could not resolve authenticated X user id.");

  const all: Array<Record<string, unknown>> = [];
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const resp = (await client.v2.get(`users/${userId}/tweets`, {
      max_results: Math.max(5, Math.min(100, pageSize)),
      exclude: "replies,retweets",
      "tweet.fields": "created_at,public_metrics,organic_metrics,non_public_metrics",
      pagination_token: nextToken,
    })) as { data?: unknown; meta?: { next_token?: string } };

    const pageRows = Array.isArray(resp.data)
      ? (resp.data.filter((v) => typeof v === "object" && v != null) as Array<Record<string, unknown>>)
      : [];

    all.push(...pageRows);

    nextToken = resp.meta?.next_token;
    if (!nextToken) break;
  }

  return all;
}

async function main(): Promise<number> {
  const missing = validateConfig({ requireX: true, requireOpenai: false, requireApiSports: false });
  if (missing.length > 0) {
    console.error("Missing required env vars for backfill:", missing.join(", "));
    return 1;
  }

  if (!existsSync(LOG_FILE)) {
    console.error(`Missing log file: ${LOG_FILE}`);
    return 1;
  }

  const store = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  const existingIds = new Set(store.tweets.map((t) => t.tweetId).filter(Boolean));

  const successfulPosts = parseSuccessfulLogTexts(readFileSync(LOG_FILE, "utf-8"));

  const tweets = await fetchMyRecentTweets();
  if (tweets.length === 0) {
    console.log("No tweets returned from X timeline; nothing to backfill.");
    return 0;
  }

  let inserted = 0;
  let matched = 0;

  for (const post of successfulPosts) {
    const best = tweets
      .map((tweet) => {
        const id = typeof tweet.id === "string" ? tweet.id : "";
        const text = typeof tweet.text === "string" ? tweet.text : "";
        const createdAt = typeof tweet.created_at === "string" ? tweet.created_at : post.postedAt;
        const similarity = textSimilarity(post.text, text);
        return { id, text, createdAt, similarity };
      })
      .sort((a, b) => b.similarity - a.similarity)[0];

    if (!best || !best.id || best.similarity < 0.8) continue;
    matched++;
    if (existingIds.has(best.id)) continue;

    upsertTweetRecord(store, {
      runId: randomUUID(),
      tweetId: best.id,
      postedAt: best.createdAt,
      dateContext: best.createdAt.slice(0, 10),
      sport: /#nfl/i.test(best.text)
        ? "nfl"
        : /#mlb/i.test(best.text)
          ? "mlb"
          : /#mls|#soccer/i.test(best.text)
            ? "soccer"
            : "nba",
      angle: "historical-backfill",
      source: "historical-backfill",
      status: "posted",
      text: best.text,
    });
    existingIds.add(best.id);
    inserted++;
  }

  // Fallback: if logs don't match timeline text, import recent account tweets directly.
  if (inserted === 0) {
    for (const tweet of tweets) {
      const id = typeof tweet.id === "string" ? tweet.id : "";
      const text = typeof tweet.text === "string" ? tweet.text : "";
      const createdAt = typeof tweet.created_at === "string" ? tweet.created_at : new Date().toISOString();
      if (!id || !text) continue;
      if (existingIds.has(id)) continue;
      if (!/postgame ai|getpostgame\\.ai|postgame\\.ai/i.test(text)) continue;

      upsertTweetRecord(store, {
        runId: randomUUID(),
        tweetId: id,
        postedAt: createdAt,
        dateContext: createdAt.slice(0, 10),
        sport: /#nfl/i.test(text)
          ? "nfl"
          : /#mlb/i.test(text)
            ? "mlb"
            : /#mls|#soccer/i.test(text)
              ? "soccer"
              : "nba",
        angle: "historical-backfill",
        source: "historical-backfill",
        status: "posted",
        text,
      });
      existingIds.add(id);
      inserted++;
    }
  }

  const xClient = getXClient();
  if (!xClient) {
    console.error("Unable to initialize X client while refreshing backfilled metrics.");
    return 1;
  }

  const refresh = await refreshMetricsForStore(store, xClient, {
    lookbackDays: 90,
    minAgeMinutes: 0,
    maxTweets: 200,
  });

  pruneStore(store);
  saveAnalyticsStore(store, ANALYTICS_STORE_FILE);

  console.log(`Backfill complete: matched ${matched}, inserted ${inserted}, metrics updated ${refresh.updated}.`);
  console.log(`Store: ${ANALYTICS_STORE_FILE}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
