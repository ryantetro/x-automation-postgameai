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
  pruneStore,
} from "../src/analytics.js";
import { getXClient } from "../src/postToX.js";

async function main(): Promise<number> {
  if (!ANALYTICS_ENABLED) {
    console.log("ANALYTICS_ENABLED=false; skipping metrics pull.");
    return 0;
  }

  const missing = validateConfig({ requireX: true, requireOpenai: false, requireApiSports: false });
  if (missing.length > 0) {
    console.error("Missing required env vars for analytics:", missing.join(", "));
    return 1;
  }

  const xClient = getXClient();
  if (!xClient) {
    console.error("Unable to initialize X client; check OAuth env vars.");
    return 1;
  }

  const store = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  if (store.tweets.length === 0) {
    console.log("No tweet records yet; nothing to refresh.");
    return 0;
  }

  const refreshed = await refreshMetricsForStore(store, xClient, {
    lookbackDays: ANALYTICS_LOOKBACK_DAYS,
    minAgeMinutes: ANALYTICS_MIN_AGE_MINUTES,
    maxTweets: ANALYTICS_MAX_REFRESH,
  });

  pruneStore(store);
  saveAnalyticsStore(store, ANALYTICS_STORE_FILE);

  console.log(`Analytics refresh complete: updated ${refreshed.updated} tweet(s), attempted ${refreshed.attempted}.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
