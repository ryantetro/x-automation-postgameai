import { TwitterApi } from "twitter-api-v2";
import type { TwitterApiTokens } from "twitter-api-v2";
import {
  POST_ENABLED,
  X_CONSUMER_KEY,
  X_CONSUMER_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
} from "./config.js";

export function postToX(text: string): Promise<{ success: boolean; error?: string }> {
  if (!POST_ENABLED) {
    const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
    console.info("Dry run: would post:", preview);
    return Promise.resolve({ success: true });
  }
  if (!X_CONSUMER_KEY || !X_CONSUMER_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    return Promise.resolve({ success: false, error: "Missing X OAuth credentials" });
  }
  const tokens: TwitterApiTokens = {
    appKey: X_CONSUMER_KEY,
    appSecret: X_CONSUMER_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  };
  const client = new TwitterApi(tokens);
  return client.v2
    .tweet(text)
    .then(() => {
      console.info("Posted to X successfully");
      return { success: true };
    })
    .catch((err: Error & { code?: number; data?: { status?: number } }) => {
      console.error("Failed to post to X:", err);
      const code = typeof err?.code === "number" ? err.code : err?.data?.status;
      return { success: false, error: err.message, statusCode: code };
    });
}

export type PostResult = { success: boolean; error?: string; statusCode?: number };
