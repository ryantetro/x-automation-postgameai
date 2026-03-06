import { MAX_TWEET_LEN } from "./config.js";

/** Company name (spelled with space). */
export const BRAND_NAME = "postgame AI";
/** Website. */
export const BRAND_WEBSITE = "getpostgame.ai";

export function isValidTweet(text: string | null | undefined): boolean {
  if (text == null || typeof text !== "string") return false;
  const t = text.trim();
  if (t.length > MAX_TWEET_LEN) return false;
  if (!t.includes(BRAND_NAME)) return false;
  if (!t.includes(BRAND_WEBSITE)) return false;
  return true;
}
