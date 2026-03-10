import { resolve } from "node:path";
import { loadAnalyticsStore, saveAnalyticsStore, type TweetAnalyticsRecord } from "../src/analytics.js";
import { STATE_DIR } from "../src/config.js";
import { FRAME_DEFINITIONS, HOOK_DEFINITIONS } from "../src/contentArchitecture.js";
import {
  inferEmotionFromText,
  inferFrameFromRecord,
  inferHookFromText,
  inferNewsMomentType,
  getOpeningPattern,
} from "../src/contentHeuristics.js";

const STATE_FILES = [
  resolve(STATE_DIR, "tweet-analytics.json"),
  resolve(STATE_DIR, "threads-analytics.json"),
];

function backfillRecord(record: TweetAnalyticsRecord): TweetAnalyticsRecord {
  const contentFrameId =
    record.contentFrameId ?? inferFrameFromRecord(record);
  const hookStructureId =
    record.hookStructureId ?? inferHookFromText(record.text);
  const emotionTarget =
    record.emotionTarget ?? inferEmotionFromText(record.text, contentFrameId);

  return {
    ...record,
    contentFrameId,
    contentFrameLabel: record.contentFrameLabel ?? FRAME_DEFINITIONS[contentFrameId].label,
    hookStructureId,
    hookStructureLabel: record.hookStructureLabel ?? HOOK_DEFINITIONS[hookStructureId].label,
    emotionTarget,
    newsMomentType: record.newsMomentType ?? inferNewsMomentType(record.newsArticleTitle),
    openingPattern: record.openingPattern ?? getOpeningPattern(record.text),
  };
}

function main(): number {
  for (const path of STATE_FILES) {
    const store = loadAnalyticsStore(path);
    store.tweets = store.tweets.map(backfillRecord);
    saveAnalyticsStore(store, path);
    console.log(`Backfilled content architecture metadata in ${path}`);
  }
  return 0;
}

process.exit(main());
