import { MAX_POST_LEN, BRAND_NAME, BRAND_WEBSITE } from "./config.js";

export { BRAND_NAME, BRAND_WEBSITE };

export interface ValidateTweetOptions {
  /** When false (e.g. angles_only campaigns), allow posts without brand/website so questions can skip the tag. Default true. */
  requireBrand?: boolean;
}

export function isValidTweet(
  text: string | null | undefined,
  options: ValidateTweetOptions = {}
): boolean {
  if (text == null || typeof text !== "string") return false;
  const t = text.trim();
  if (t.length > MAX_POST_LEN) return false;
  const { requireBrand = true } = options;
  if (requireBrand) {
    if (!t.includes(BRAND_NAME)) return false;
    if (!t.includes(BRAND_WEBSITE)) return false;
  }
  return true;
}
