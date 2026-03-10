import {
  ANALYTICS_ENABLED,
  ANALYTICS_LOOKBACK_DAYS,
  ANALYTICS_MAX_REFRESH,
  ANALYTICS_MIN_AGE_MINUTES,
  validateConfig,
} from "../src/config.js";
import {
  ANALYTICS_STORE_FILE,
  loadAnalyticsStore,
  saveAnalyticsStore,
  refreshMetricsForStore,
  refreshThreadsMetricsForStore,
  pruneStore,
} from "../src/analytics.js";
import { getXClient } from "../src/postToX.js";
import { THREADS_ACCESS_TOKEN } from "../src/config.js";

async function main(): Promise<number> {
  if (!ANALYTICS_ENABLED) {
    console.log("ANALYTICS_ENABLED=false; skipping metrics pull.");
    return 0;
  }

  const store = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  if (store.tweets.length === 0) {
    console.log("No tweet records yet; nothing to refresh.");
    return 0;
  }

  let refreshedX = { updated: 0, attempted: 0 };
  const hasXPosts = store.tweets.some((tweet) => !!tweet.tweetId);
  if (hasXPosts) {
    const missing = validateConfig({ requireX: true, requireOpenai: false, requireApiSports: false });
    if (missing.length > 0) {
      console.warn("Skipping X analytics refresh due to missing env vars:", missing.join(", "));
    } else {
      const xClient = getXClient();
      if (!xClient) {
        console.warn("Skipping X analytics refresh because the X client could not be initialized.");
      } else {
        refreshedX = await refreshMetricsForStore(store, xClient, {
          lookbackDays: ANALYTICS_LOOKBACK_DAYS,
          minAgeMinutes: ANALYTICS_MIN_AGE_MINUTES,
          maxTweets: ANALYTICS_MAX_REFRESH,
        });
      }
    }
  }

  let refreshedThreads = { updated: 0, attempted: 0, userInsightsUpdated: false };
  const hasThreadsPosts = store.tweets.some((tweet) => !!tweet.threadsPostId);
  if (hasThreadsPosts) {
    if (!THREADS_ACCESS_TOKEN) {
      console.warn("Skipping Threads analytics refresh because THREADS_ACCESS_TOKEN is not set.");
    } else {
      refreshedThreads = await refreshThreadsMetricsForStore(store, {
        lookbackDays: ANALYTICS_LOOKBACK_DAYS,
        minAgeMinutes: ANALYTICS_MIN_AGE_MINUTES,
        maxTweets: ANALYTICS_MAX_REFRESH,
      });
    }
  }

  pruneStore(store);
  saveAnalyticsStore(store, ANALYTICS_STORE_FILE);

  console.log(
    `Analytics refresh complete: X updated ${refreshedX.updated}/${refreshedX.attempted}, Threads updated ${refreshedThreads.updated}/${refreshedThreads.attempted}${
      refreshedThreads.userInsightsUpdated ? ", Threads user insights updated" : ""
    }.`
  );
  if (store.analyticsHealth?.x) {
    console.log(
      `X analytics health: ${store.analyticsHealth.x.status}${
        store.analyticsHealth.x.lastError ? ` (${store.analyticsHealth.x.lastError})` : ""
      }`
    );
  }
  if (store.analyticsHealth?.threads) {
    console.log(
      `Threads analytics health: ${store.analyticsHealth.threads.status}${
        store.analyticsHealth.threads.lastError ? ` (${store.analyticsHealth.threads.lastError})` : ""
      }`
    );
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
