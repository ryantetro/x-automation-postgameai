/**
 * Safe production preflight for the current runtime env/campaign.
 * Read-only checks only: no posting, no analytics state writes.
 *
 * Typical usage:
 *   node --import tsx scripts/preflight-prod.ts
 *   CAMPAIGN=canopy node --import tsx scripts/preflight-prod.ts
 *   POST_TARGETS=threads node --import tsx scripts/preflight-prod.ts
 */
import { bootstrap } from "../src/bootstrap.js";
import { resolve } from "node:path";

process.env.POST_ENABLED = "false";
bootstrap();

type CheckStatus = "pass" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: CheckStatus;
  details: string;
}

function print(result: CheckResult): void {
  const icon = result.status === "pass" ? "PASS" : result.status === "warn" ? "WARN" : "FAIL";
  console.log(`[${icon}] ${result.name}: ${result.details}`);
}

function cloneStore<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getLinkReserveChars(clickTargetUrl: string, brandWebsite: string): number {
  let linkToAppend: string | null = clickTargetUrl || null;
  if (linkToAppend && brandWebsite) {
    try {
      const website = brandWebsite.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
      const host = new URL(linkToAppend).host.toLowerCase();
      if (host === website || host.endsWith(`.${website}`)) linkToAppend = null;
    } catch {
      // keep linkToAppend as-is
    }
  }
  return linkToAppend ? linkToAppend.length + 1 : 0;
}

async function checkTextGeneration(): Promise<CheckResult> {
  const config = await import("../src/config.js");
  const { isValidTweet } = await import("../src/validate.js");
  const reserveChars = getLinkReserveChars(config.CLICK_TARGET_URL, config.BRAND_WEBSITE);

  if (config.DATA_SOURCE === "angles_only") {
    const { generatePostAnglesOnly } = await import("../src/generatePost.js");
    const angle = config.getAngleForDateAnglesOnly(new Date());
    const generated = await generatePostAnglesOnly({
      angle,
      date: new Date().toISOString().slice(0, 10),
      reserveChars,
    });
    const text = generated.text?.trim() ?? "";
    if (!isValidTweet(text, { requireBrand: false })) {
      return { name: "Text generation", status: "fail", details: "angles_only generation returned invalid text" };
    }
    return {
      name: "Text generation",
      status: "pass",
      details: `angles_only post generated (${text.length}/280) for "${angle}"`,
    };
  }

  const { fetchSportsData } = await import("../src/fetchData.js");
  const { fetchNewsContext } = await import("../src/fetchNews.js");
  const { selectContentDecision } = await import("../src/contentArchitecture.js");
  const { generatePost } = await import("../src/generatePost.js");
  const sport = config.getSportForRun();
  const fetched =
    (await fetchSportsData(sport)) ?? {
      sport,
      source: "none",
      date: new Date().toISOString().slice(0, 10),
      games: [],
      summary: "No games today.",
      top_game: {},
    };
  const newsContext = await fetchNewsContext(sport);
  const decision = selectContentDecision({
    sport,
    date: new Date().toISOString().slice(0, 10),
    targetPlatforms: [...config.POST_TARGETS],
    newsArticle: newsContext.selectedArticle,
    newsUsed: newsContext.usedNews,
    recentDecisions: [],
  });
  const generated = await generatePost(fetched, 1, {
    angle: config.getAngleForDate(new Date()),
    date: new Date().toISOString().slice(0, 10),
    reserveChars,
    newsContext,
    contentDecision: decision,
    recentContentDecisions: [],
  });
  const text = generated.text?.trim() ?? "";
  if (!isValidTweet(text)) {
    return { name: "Text generation", status: "fail", details: "sports/news generation returned invalid text" };
  }
  return {
    name: "Text generation",
    status: "pass",
    details: `sports/news post generated (${text.length}/${config.MAX_POST_LEN}) for ${sport.toUpperCase()}`,
  };
}

async function checkImageGeneration(): Promise<CheckResult | null> {
  const config = await import("../src/config.js");
  if (config.DATA_SOURCE !== "angles_only" || !config.IMAGE_ENABLED) return null;
  const { generateCampaignImage } = await import("../src/generateImage.js");
  const angle = config.getAngleForDateAnglesOnly(new Date());
  const image = await generateCampaignImage(angle);
  if (!image.buffer || image.buffer.length === 0) {
    return { name: "Image generation", status: "fail", details: `no image buffer returned for "${angle}"` };
  }
  return {
    name: "Image generation",
    status: "pass",
    details: `campaign image generated for "${angle}" (${image.buffer.length} bytes)`,
  };
}

async function checkXAnalytics(): Promise<CheckResult | null> {
  const config = await import("../src/config.js");
  const { getXClient } = await import("../src/postToX.js");
  const { loadAnalyticsStore, refreshMetricsForStore } = await import("../src/analytics.js");

  const xClient = getXClient();
  const store = loadAnalyticsStore(resolve(config.STATE_DIR, "tweet-analytics.json"));
  const hasXPosts = store.tweets.some((tweet) => !!tweet.tweetId);
  if (!xClient || !hasXPosts) return null;

  const copy = cloneStore(store);
  let forced = 0;
  for (const tweet of copy.tweets) {
    if (tweet.tweetId) {
      delete tweet.metrics;
      delete tweet.score;
      delete tweet.scoreUpdatedAt;
      forced++;
      break;
    }
  }
  const refresh = await refreshMetricsForStore(copy, xClient, {
    lookbackDays: 90,
    minAgeMinutes: 0,
    maxTweets: 5,
  });
  const health = copy.analyticsHealth?.x;
  if (health?.status === "blocked") {
    return {
      name: "X analytics",
      status: "fail",
      details: health.lastError ?? "X analytics blocked for this account",
    };
  }
  if (refresh.updated > 0) {
    return {
      name: "X analytics",
      status: "pass",
      details: `refreshed ${refresh.updated}/${refresh.attempted} tweet metrics`,
    };
  }
  return {
    name: "X analytics",
    status: "warn",
    details: forced > 0 ? "no metrics refreshed for forced test tweet" : "no X tweets eligible for refresh",
  };
}

async function checkXTimelineAccess(): Promise<CheckResult | null> {
  const { getXClient } = await import("../src/postToX.js");
  const client = getXClient();
  if (!client) return null;

  try {
    const me = (await client.v2.get("users/me")) as { data?: { id?: string } };
    const userId = me?.data?.id;
    if (!userId) {
      return { name: "X timeline access", status: "fail", details: "could not resolve authenticated X user id" };
    }
    const resp = (await client.v2.get(`users/${userId}/tweets`, {
      max_results: 5,
      exclude: "replies,retweets",
      "tweet.fields": "created_at",
    })) as { data?: unknown };
    const count = Array.isArray(resp.data) ? resp.data.length : 0;
    return { name: "X timeline access", status: "pass", details: `timeline read succeeded (${count} tweet(s))` };
  } catch (err) {
    return {
      name: "X timeline access",
      status: "fail",
      details: err instanceof Error ? err.message : "timeline read failed",
    };
  }
}

async function checkThreadsAnalytics(): Promise<CheckResult | null> {
  const config = await import("../src/config.js");
  const { loadAnalyticsStore, refreshThreadsMetricsForStore } = await import("../src/analytics.js");
  if (!config.THREADS_ACCESS_TOKEN) return null;

  const store = loadAnalyticsStore(resolve(config.STATE_DIR, "threads-analytics.json"));
  const hasThreadsPosts = store.tweets.some((tweet) => !!tweet.threadsPostId);
  if (!hasThreadsPosts) return null;

  const copy = cloneStore(store);
  let forced = 0;
  for (const tweet of copy.tweets) {
    if (tweet.threadsPostId) {
      delete tweet.metrics;
      delete tweet.score;
      delete tweet.scoreUpdatedAt;
      forced++;
      if (forced >= 3) break;
    }
  }

  const refresh = await refreshThreadsMetricsForStore(copy, {
    lookbackDays: 90,
    minAgeMinutes: 0,
    maxTweets: 5,
  });
  const health = copy.analyticsHealth?.threads;
  const permanentlySkipped = copy.tweets.filter((tweet) => tweet.analyticsFetchState?.threads?.permanent).length;

  if (refresh.updated > 0 || refresh.userInsightsUpdated) {
    return {
      name: "Threads analytics",
      status: permanentlySkipped > 0 ? "warn" : "pass",
      details: `refreshed ${refresh.updated}/${refresh.attempted} post metrics, user insights ${
        refresh.userInsightsUpdated ? "ok" : "missing"
      }${permanentlySkipped > 0 ? `, ${permanentlySkipped} historical post(s) permanently skipped` : ""}`,
    };
  }

  return {
    name: "Threads analytics",
    status: health?.status === "degraded" ? "warn" : "fail",
    details: health?.lastError ?? "no Threads metrics or user insights returned",
  };
}

async function checkHistoricalBackfill(): Promise<CheckResult | null> {
  const { getXClient } = await import("../src/postToX.js");
  const client = getXClient();
  if (!client) return null;

  try {
    const me = (await client.v2.get("users/me")) as { data?: { id?: string } };
    const userId = me?.data?.id;
    if (!userId) {
      return { name: "Historical X backfill access", status: "fail", details: "could not resolve X user id" };
    }
    const resp = (await client.v2.get(`users/${userId}/tweets`, {
      max_results: 10,
      exclude: "replies,retweets",
      "tweet.fields": "created_at,public_metrics",
    })) as { data?: unknown };
    const count = Array.isArray(resp.data) ? resp.data.length : 0;
    return {
      name: "Historical X backfill access",
      status: "pass",
      details: `timeline/backfill read succeeded (${count} recent tweet(s))`,
    };
  } catch (err) {
    return {
      name: "Historical X backfill access",
      status: "fail",
      details: err instanceof Error ? err.message : "historical timeline read failed",
    };
  }
}

async function main(): Promise<number> {
  const config = await import("../src/config.js");
  const results: CheckResult[] = [];

  const baseMissing = config.validateConfig({
    requireOpenai: true,
    requireX: false,
    requireThreads: false,
    requireApiSports: false,
  });
  results.push(
    baseMissing.length === 0
      ? { name: "Env validation", status: "pass", details: "core generation env is present" }
      : { name: "Env validation", status: "fail", details: `missing: ${baseMissing.join(", ")}` }
  );

  try {
    results.push(await checkTextGeneration());
  } catch (err) {
    results.push({
      name: "Text generation",
      status: "fail",
      details: err instanceof Error ? err.message : "generation failed",
    });
  }

  try {
    const image = await checkImageGeneration();
    if (image) results.push(image);
  } catch (err) {
    results.push({
      name: "Image generation",
      status: "fail",
      details: err instanceof Error ? err.message : "image generation failed",
    });
  }

  for (const check of [checkXAnalytics, checkXTimelineAccess, checkThreadsAnalytics, checkHistoricalBackfill]) {
    try {
      const result = await check();
      if (result) results.push(result);
    } catch (err) {
      results.push({
        name: check.name,
        status: "fail",
        details: err instanceof Error ? err.message : "check failed",
      });
    }
  }

  console.log(
    `Preflight target: campaign=${process.env.CAMPAIGN?.trim() || "default"} dataSource=${config.DATA_SOURCE} targets=${config.POST_TARGETS.join(",")}`
  );
  console.log("");
  results.forEach(print);

  const failed = results.some((result) => result.status === "fail");
  const warned = results.some((result) => result.status === "warn");
  console.log("");
  console.log(
    `Summary: ${results.filter((result) => result.status === "pass").length} pass, ${results.filter((result) => result.status === "warn").length} warn, ${results.filter((result) => result.status === "fail").length} fail`
  );
  return failed ? 1 : warned ? 0 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
