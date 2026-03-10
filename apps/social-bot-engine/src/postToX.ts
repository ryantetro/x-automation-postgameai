import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
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

/**
 * Post a tweet with an image attached. Uploads media via v1 API, then tweets with v2.
 */
export async function postToXWithMedia(
  text: string,
  imageBuffer: Buffer,
  mimeType: string
): Promise<PostResult> {
  if (!POST_ENABLED) {
    const preview = text.length > 80 ? text.slice(0, 80) + "..." : text;
    console.info("Dry run: would post with image:", preview);
    return { success: true };
  }

  const client = getXClient();
  if (!client) {
    return { success: false, error: "Missing X OAuth credentials" };
  }

  const ext = mimeType === "image/png" ? "png" : "jpg";
  const tmpPath = join(tmpdir(), `canopy-${randomUUID()}.${ext}`);
  try {
    writeFileSync(tmpPath, imageBuffer);
    const mediaId = await client.v1.uploadMedia(tmpPath, { mimeType });
    const resp = await client.v2.tweet({
      text,
      media: { media_ids: [mediaId] },
    });
    const tweetId = resp?.data?.id;
    console.info("Posted to X with image successfully", tweetId ? `(tweet_id=${tweetId})` : "");
    return { success: true, tweetId };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("Failed to post to X with media:", err);
    const statusCode =
      err && typeof err === "object" && "code" in err && typeof (err as { code?: number }).code === "number"
        ? (err as { code: number }).code
        : err && typeof err === "object" && "data" in err && typeof (err as { data?: { status?: number } }).data === "object"
          ? (err as { data: { status?: number } }).data?.status
          : undefined;
    return { success: false, error, statusCode };
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup errors
    }
  }
}
