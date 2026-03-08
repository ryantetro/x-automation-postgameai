import { NextRequest, NextResponse } from "next/server";
import { recordTrackedClick, buildVisitorFingerprint } from "../../lib/clicks";
import { loadStore, type TweetAnalyticsRecord } from "../../lib/data";

export const dynamic = "force-dynamic";

function slugify(value: string, maxLength = 48): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function normalizeDestination(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

function fallbackDestination(request: NextRequest): string {
  const configured = process.env.CLICK_TARGET_URL?.trim();
  if (configured) return normalizeDestination(configured);
  return request.nextUrl.origin;
}

function withUtmParams(baseUrl: string, tweet: TweetAnalyticsRecord): string {
  const destination = new URL(normalizeDestination(baseUrl));
  const campaignPrefix = process.env.UTM_CAMPAIGN_PREFIX || "postgame_ai";
  const utmSource = process.env.UTM_SOURCE || "x";
  const utmMedium = process.env.UTM_MEDIUM || "social";
  const sport = slugify(tweet.sport || "sports", 20) || "sports";
  const date = slugify(tweet.dateContext || "unknown", 20) || "unknown";
  const angle = slugify(tweet.angle || "general", 40) || "general";
  const source = slugify(tweet.source || "automation", 20) || "automation";

  destination.searchParams.set("utm_source", utmSource);
  destination.searchParams.set("utm_medium", utmMedium);
  destination.searchParams.set("utm_campaign", `${campaignPrefix}_${sport}_${date}`);
  destination.searchParams.set("utm_content", tweet.runId);
  destination.searchParams.set("utm_term", angle);
  destination.searchParams.set("post_sport", sport);
  destination.searchParams.set("post_source", source);
  if (tweet.tweetId) destination.searchParams.set("tweet_id", tweet.tweetId);

  return destination.toString();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await context.params;
  const store = await loadStore({ includeClicks: false });
  const tweet = store.tweets.find((row) => row.runId === slug);

  if (!tweet?.trackedUrl || !tweet.linkTargetUrl) {
    return NextResponse.redirect(fallbackDestination(request), 307);
  }

  const visitorFingerprint = buildVisitorFingerprint(request.headers);
  await recordTrackedClick(slug, visitorFingerprint);

  return NextResponse.redirect(withUtmParams(tweet.linkTargetUrl, tweet), 307);
}
