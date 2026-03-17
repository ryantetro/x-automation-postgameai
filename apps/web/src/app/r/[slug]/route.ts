import { NextRequest, NextResponse } from "next/server";
import { recordTrackedClick, buildVisitorFingerprint } from "../../lib/clicks";
import { loadStore, type OutboundTrackingRecord } from "../../lib/data";

export const dynamic = "force-dynamic";

function normalizeDestination(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url.replace(/^\/+/, "")}`;
}

function fallbackDestination(request: NextRequest): string {
  const configured = process.env.CLICK_TARGET_URL?.trim();
  if (configured) return normalizeDestination(configured);
  return request.nextUrl.origin;
}

function withUtmParams(baseUrl: string, tracking: OutboundTrackingRecord): string {
  const destination = new URL(normalizeDestination(baseUrl));
  const platform = tracking.platform === "threads" ? "threads" : "x";

  destination.searchParams.set("tracking_id", tracking.trackingId);
  destination.searchParams.set("run_id", tracking.runId);
  destination.searchParams.set("platform", platform);
  if (tracking.campaignSlug) destination.searchParams.set("campaign_slug", tracking.campaignSlug);
  if (tracking.publishedPostId) destination.searchParams.set("post_id", tracking.publishedPostId);
  destination.searchParams.set("utm_source", tracking.utmSource || platform);
  destination.searchParams.set("utm_medium", tracking.utmMedium || "social");
  destination.searchParams.set("utm_campaign", tracking.utmCampaign);
  destination.searchParams.set("utm_content", tracking.utmContent || tracking.trackingId);
  destination.searchParams.set("utm_term", tracking.utmTerm || "general");
  if (tracking.postSport) destination.searchParams.set("post_sport", tracking.postSport);
  if (tracking.postSource) destination.searchParams.set("post_source", tracking.postSource);

  return destination.toString();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
): Promise<NextResponse> {
  const { slug } = await context.params;
  const store = await loadStore({ includeClicks: false });
  const tracking = store.tweets
    .flatMap((row) => row.outboundTracking ?? [])
    .find((row) => row.trackingId === slug);

  if (!tracking?.trackedUrl || !tracking.linkTargetUrl) {
    console.warn("Unknown tracking redirect requested:", slug);
    return NextResponse.redirect(fallbackDestination(request), 307);
  }

  const visitorFingerprint = buildVisitorFingerprint(request.headers);
  await recordTrackedClick(slug, visitorFingerprint);

  return NextResponse.redirect(withUtmParams(tracking.linkTargetUrl, tracking), 307);
}
