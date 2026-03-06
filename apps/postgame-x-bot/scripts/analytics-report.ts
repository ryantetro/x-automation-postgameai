import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOGS_DIR } from "../src/config.js";
import {
  ANALYTICS_STORE_FILE,
  buildIterationInsights,
  loadAnalyticsStore,
  formatInsightsReport,
  type TweetAnalyticsRecord,
} from "../src/analytics.js";

const REPORT_FILE = resolve(LOGS_DIR, "iteration-report.md");

function avg(records: TweetAnalyticsRecord[], selector: (tweet: TweetAnalyticsRecord) => number): number {
  if (records.length === 0) return 0;
  return Number((records.reduce((sum, tweet) => sum + selector(tweet), 0) / records.length).toFixed(2));
}

function buildPerformanceAppendix(store: ReturnType<typeof loadAnalyticsStore>): string {
  const posted = store.tweets.filter((tweet) => tweet.status === "posted");
  const withMetrics = posted.filter((tweet) => tweet.metrics);
  const lines: string[] = [];

  lines.push("## Performance summary");
  lines.push(`- Posted tweets: ${posted.length}`);
  lines.push(`- Tweets with metrics: ${withMetrics.length}`);
  lines.push(
    `- Avg impressions overall: ${avg(withMetrics, (tweet) => tweet.metrics?.impressionCount ?? 0)}`
  );
  lines.push(
    `- Avg clicks overall: ${avg(posted, (tweet) => tweet.clickMetrics?.totalClicks ?? 0)}`
  );
  lines.push("");

  lines.push("## Content mode stats");
  const modes = ["sports_only", "news_preferred"] as const;
  const modeRows = modes
    .map((mode) => {
      const records = posted.filter((tweet) => tweet.contentMode === mode);
      return {
        mode,
        count: records.length,
        avgImpressions: avg(records, (tweet) => tweet.metrics?.impressionCount ?? 0),
        avgClicks: avg(records, (tweet) => tweet.clickMetrics?.totalClicks ?? 0),
      };
    })
    .filter((row) => row.count > 0);

  if (modeRows.length === 0) {
    lines.push("- No content mode data yet.");
  } else {
    for (const row of modeRows) {
      lines.push(`- ${row.mode}: ${row.count} post(s), avg impressions ${row.avgImpressions}, avg clicks ${row.avgClicks}`);
    }
  }
  lines.push("");

  lines.push("## News usage stats");
  const newsRows = [true, false]
    .map((newsUsed) => {
      const records = posted.filter((tweet) => Boolean(tweet.newsUsed) === newsUsed);
      return {
        label: newsUsed ? "news_used" : "sports_only_fallback",
        count: records.length,
        avgImpressions: avg(records, (tweet) => tweet.metrics?.impressionCount ?? 0),
        avgClicks: avg(records, (tweet) => tweet.clickMetrics?.totalClicks ?? 0),
      };
    })
    .filter((row) => row.count > 0);

  if (newsRows.length === 0) {
    lines.push("- No news usage data yet.");
  } else {
    for (const row of newsRows) {
      lines.push(`- ${row.label}: ${row.count} post(s), avg impressions ${row.avgImpressions}, avg clicks ${row.avgClicks}`);
    }
  }
  lines.push("");

  lines.push("## Top news-assisted tweets");
  const topNewsTweets = posted
    .filter((tweet) => tweet.newsUsed)
    .sort((a, b) => (b.metrics?.impressionCount ?? 0) - (a.metrics?.impressionCount ?? 0))
    .slice(0, 5);
  if (topNewsTweets.length === 0) {
    lines.push("- No news-assisted tweets yet.");
  } else {
    for (const tweet of topNewsTweets) {
      lines.push(
        `- (${tweet.metrics?.impressionCount ?? 0} impressions) ${tweet.newsSourceName ?? "Unknown source"}: ${tweet.text}`
      );
    }
  }
  lines.push("");

  lines.push("## Top news sources");
  const sourceMap = new Map<string, TweetAnalyticsRecord[]>();
  for (const tweet of posted) {
    if (!tweet.newsUsed || !tweet.newsSourceName) continue;
    const bucket = sourceMap.get(tweet.newsSourceName) ?? [];
    bucket.push(tweet);
    sourceMap.set(tweet.newsSourceName, bucket);
  }
  const sourceRows = [...sourceMap.entries()]
    .map(([sourceName, records]) => ({
      sourceName,
      count: records.length,
      avgImpressions: avg(records, (tweet) => tweet.metrics?.impressionCount ?? 0),
      avgClicks: avg(records, (tweet) => tweet.clickMetrics?.totalClicks ?? 0),
    }))
    .sort((a, b) => b.avgImpressions - a.avgImpressions)
    .slice(0, 5);

  if (sourceRows.length === 0) {
    lines.push("- No news source performance yet.");
  } else {
    for (const row of sourceRows) {
      lines.push(`- ${row.sourceName}: ${row.count} post(s), avg impressions ${row.avgImpressions}, avg clicks ${row.avgClicks}`);
    }
  }

  return lines.join("\n");
}

function main(): number {
  const store = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  const insights = buildIterationInsights(store);
  const sections: string[] = [];

  if (insights) {
    sections.push(formatInsightsReport(insights));
  } else {
    sections.push("# Tweet iteration report");
    sections.push("");
    sections.push("Not enough scored tweets yet. Need at least 6 posted tweets with metrics.");
  }
  sections.push("");
  sections.push(buildPerformanceAppendix(store));
  const report = sections.join("\n");
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(REPORT_FILE, `${report}\n`, "utf-8");

  console.log(report);
  console.log(`\nSaved report to ${REPORT_FILE}`);
  return 0;
}

process.exit(main());
