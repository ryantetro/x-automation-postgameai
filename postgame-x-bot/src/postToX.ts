import { TwitterApi } from "twitter-api-v2";
import type { TwitterApiTokens } from "twitter-api-v2";
import {
  POST_ENABLED,
  X_CONSUMER_KEY,
  X_CONSUMER_SECRET,
  X_ACCESS_TOKEN,
  X_ACCESS_TOKEN_SECRET,
} from "./config.js";

export type PostResult = { success: boolean; error?: string; statusCode?: number; tweetId?: string };

export function getXClient(): TwitterApi | null {
  if (!X_CONSUMER_KEY || !X_CONSUMER_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    return null;
  }
  const tokens: TwitterApiTokens = {
    appKey: X_CONSUMER_KEY,
    appSecret: X_CONSUMER_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  };
  return new TwitterApi(tokens);
}

export function postToX(text: string): Promise<PostResult> {
  if (!POST_ENABLED) {
    const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
    console.info("Dry run: would post:", preview);
    return Promise.resolve({ success: true });
  }

  const client = getXClient();
  if (!client) {
    return Promise.resolve({ success: false, error: "Missing X OAuth credentials" });
  }

  return client.v2
    .tweet(text)
    .then((resp: { data?: { id?: string } }) => {
      const tweetId = resp?.data?.id;
      console.info("Posted to X successfully", tweetId ? `(tweet_id=${tweetId})` : "");
      return { success: true, tweetId };
    })
    .catch((err: Error & { code?: number; data?: { status?: number } }) => {
      console.error("Failed to post to X:", err);
      const code = typeof err?.code === "number" ? err.code : err?.data?.status;
      return { success: false, error: err.message, statusCode: code };
    });
}
