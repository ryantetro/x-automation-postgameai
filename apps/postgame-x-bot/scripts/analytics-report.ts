import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LOGS_DIR } from "../src/config.js";
import {
  ANALYTICS_STORE_FILE,
  buildIterationInsights,
  formatInsightsReport,
  loadAnalyticsStore,
} from "../src/analytics.js";

const REPORT_FILE = resolve(LOGS_DIR, "iteration-report.md");

function main(): number {
  const store = loadAnalyticsStore(ANALYTICS_STORE_FILE);
  const insights = buildIterationInsights(store);

  if (!insights) {
    console.log("Not enough scored tweets yet. Need at least 6 posted tweets with metrics.");
    return 0;
  }

  const report = formatInsightsReport(insights);
  mkdirSync(LOGS_DIR, { recursive: true });
  writeFileSync(REPORT_FILE, `${report}\n`, "utf-8");

  console.log(report);
  console.log(`\nSaved report to ${REPORT_FILE}`);
  return 0;
}

process.exit(main());
