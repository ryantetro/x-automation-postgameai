import {
  loadStore,
  compact,
  sportClass,
  safeDate,
  lastUpdatedStr,
  platformClass,
  platformLabel,
  frameLabel,
  hookLabel,
  frameClass,
} from "./lib/data";
import Sidebar from "./components/Sidebar";
import InteractiveTimelineChart from "./components/InteractiveTimelineChart";
import RefreshDataButton from "./components/RefreshDataButton";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const params = await searchParams;
  const campaignSlug = params.campaign;
  const store = await loadStore({ campaignSlug });

  const posted = store.tweets.filter((t) => t.status === "posted").sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  const recent = posted.slice(-12).reverse();
  const tracked = posted.filter((t) => !!t.metrics);
  const xPosts = posted.filter((t) => !!t.tweetId).length;
  const threadsPosts = posted.filter((t) => !!t.threadsPostId).length;
  const dualPosts = posted.filter((t) => !!t.tweetId && !!t.threadsPostId).length;
  const frameCounts = new Map<string, number>();
  const hookCounts = new Map<string, number>();
  const openingCounts = new Map<string, number>();
  for (const post of posted) {
    frameCounts.set(frameLabel(post), (frameCounts.get(frameLabel(post)) ?? 0) + 1);
    if (post.hookStructureId) hookCounts.set(hookLabel(post), (hookCounts.get(hookLabel(post)) ?? 0) + 1);
    if (post.openingPattern) openingCounts.set(post.openingPattern, (openingCounts.get(post.openingPattern) ?? 0) + 1);
  }
  const topFrame = [...frameCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topHook = [...hookCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const overusedOpener = [...openingCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const totalImpressions = tracked.reduce((s, t) => s + (t.metrics?.impressionCount ?? 0), 0);
  const totalEngagements = tracked.reduce((s, t) => s + (t.metrics?.engagementCount ?? 0), 0);
  const totalLikes = tracked.reduce((s, t) => s + (t.metrics?.likeCount ?? 0), 0);
  const totalRetweets = tracked.reduce((s, t) => s + (t.metrics?.retweetCount ?? 0), 0);
  const totalReplies = tracked.reduce((s, t) => s + (t.metrics?.replyCount ?? 0), 0);
  const totalBookmarks = tracked.reduce((s, t) => s + (t.metrics?.bookmarkCount ?? 0), 0);
  const totalShares = tracked.reduce((s, t) => s + (t.metrics?.shareCount ?? 0), 0);
  const hasTrackedLinks = posted.some((t) => !!t.trackedUrl);
  const hasClickMetrics = posted.some((t) => !!t.clickMetrics);
  const totalClicks = hasClickMetrics ? posted.reduce((s, t) => s + (t.clickMetrics?.totalClicks ?? 0), 0) : null;
  const totalUniqueClicks = hasClickMetrics ? posted.reduce((s, t) => s + (t.clickMetrics?.uniqueClicks ?? 0), 0) : null;
  const avgRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
  const threadFollowers = store.threadsUserInsights?.followersCount ?? null;
  const threadProfileViews = store.threadsUserInsights?.views ?? null;

  const engMax = Math.max(totalLikes, totalRetweets, totalReplies, totalBookmarks, totalShares, 1);
  const engRows = [
    { label: "Likes", icon: "♥", value: totalLikes, pct: (totalLikes / engMax) * 100, color: "var(--red)", bg: "var(--red-soft)" },
    { label: "Reposts", icon: "↻", value: totalRetweets, pct: (totalRetweets / engMax) * 100, color: "var(--accent)", bg: "var(--accent-soft)" },
    { label: "Replies", icon: "↩", value: totalReplies, pct: (totalReplies / engMax) * 100, color: "var(--blue)", bg: "var(--blue-soft)" },
    { label: "Bookmarks", icon: "⚑", value: totalBookmarks, pct: (totalBookmarks / engMax) * 100, color: "var(--amber)", bg: "var(--amber-soft)" },
    { label: "Shares", icon: "⇪", value: totalShares, pct: (totalShares / engMax) * 100, color: "var(--text-secondary)", bg: "var(--glass-strong)" },
  ].sort((a, b) => b.value - a.value);

  const lastUpdated = lastUpdatedStr(store.updatedAt);

  return (
    <div className="dash">
      <Sidebar activePage="dashboard" campaignSlug={campaignSlug} />
      <main className="main">
        <header className="header">
          <div className="header-left">
            <span className="page-kicker">{store.activeCampaign ? store.activeCampaign.name : "All campaigns"}</span>
            <h2>Dashboard</h2>
            <span>{posted.length} posts &middot; {xPosts} X &middot; {threadsPosts} Threads</span>
          </div>
          <div className="header-right">
            <RefreshDataButton />
            <span className="header-badge">{dualPosts} dual-published</span>
            <span className="header-badge">{store.updatedAt ? `Updated ${lastUpdated}` : "Awaiting data"}</span>
          </div>
        </header>

        <div className="content">
          <div className="stat-grid">
            <div className="stat-card green">
              <div className="stat-label">Total impressions</div>
              <div className="stat-value">{compact(totalImpressions)}</div>
              <div className="stat-sub">{tracked.length} tracked posts</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-label">Total engagement</div>
              <div className="stat-value stat-value-blue">{compact(totalEngagements)}</div>
              <div className="stat-sub">Likes + reposts + replies + quotes</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Threads followers</div>
              <div className="stat-value">{threadFollowers === null ? "—" : compact(threadFollowers)}</div>
              <div className="stat-sub">{threadProfileViews === null ? "No profile views yet" : `${compact(threadProfileViews)} profile views`}</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Engagement rate</div>
              <div className="stat-value">{avgRate.toFixed(2)}%</div>
              <div className="stat-sub">
                {!hasTrackedLinks
                  ? "No tracked links"
                  : totalClicks === null || totalUniqueClicks === null
                    ? "Click analytics unavailable"
                    : `${compact(totalClicks)} clicks · ${compact(totalUniqueClicks)} unique`}
              </div>
            </div>
          </div>

          <div className="panels">
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <InteractiveTimelineChart
                records={posted.map((tweet) => ({
                  runId: tweet.runId,
                  postedAt: tweet.postedAt,
                  sport: tweet.sport,
                  angle: tweet.angle,
                  tweetId: tweet.tweetId,
                  threadsPostId: tweet.threadsPostId,
                  platform: tweet.metrics?.platform === "threads" ? "threads" : tweet.threadsPostId && !tweet.tweetId ? "threads" : "x",
                  metrics: tweet.metrics
                    ? {
                        impressionCount: tweet.metrics.impressionCount,
                        engagementCount: tweet.metrics.engagementCount,
                        likeCount: tweet.metrics.likeCount,
                        retweetCount: tweet.metrics.retweetCount,
                      }
                    : undefined,
                }))}
              />

              <div className="card">
                <div className="card-header">
                  <h3>Recent posts</h3>
                  <span className="card-sub">{recent.length} shown</span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table className="posts-table">
                    <thead>
                      <tr>
                        {!campaignSlug && <th>Campaign</th>}
                        <th>Sport</th>
                        <th>Platform</th>
                        <th>Frame</th>
                        <th>Date</th>
                        <th>Impressions</th>
                        <th>Clicks</th>
                        <th>Likes</th>
                        <th>Reposts</th>
                        <th>Eng. rate</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.length > 0 ? (
                        recent.map((tweet) => {
                          const m = tweet.metrics;
                          const imp = m?.impressionCount ?? 0;
                          const engRate = m?.engagementRate ?? (imp > 0 && m ? (m.engagementCount / imp) * 100 : 0);
                          const clicks = tweet.clickMetrics?.totalClicks;
                          return (
                            <tr key={tweet.runId}>
                              {!campaignSlug && <td><span className={`campaign-badge ${tweet.campaignSlug ?? ""}`}>{store.campaigns.find((c) => c.slug === tweet.campaignSlug)?.name ?? tweet.campaignSlug ?? "—"}</span></td>}
                              <td><span className={`sport-pill ${sportClass(tweet.sport)}`}>{tweet.sport}</span></td>
                              <td><span className={`platform-pill ${platformClass(tweet)}`}>{platformLabel(tweet)}</span></td>
                              <td>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", alignItems: "flex-start" }}>
                                  <span className={`frame-pill ${frameClass(tweet.contentFrameId)}`}>{frameLabel(tweet)}</span>
                                  {tweet.hookStructureId ? <span className="hook-pill">{hookLabel(tweet)}</span> : null}
                                </div>
                              </td>
                              <td>{safeDate(tweet.postedAt)}</td>
                              <td>{compact(imp)}</td>
                              <td>{typeof clicks === "number" ? compact(clicks) : "—"}</td>
                              <td>{compact(m?.likeCount ?? 0)}</td>
                              <td>{compact(m?.retweetCount ?? 0)}</td>
                              <td><span className={`rate-badge ${engRate > 0 ? "positive" : "zero"}`}>{engRate.toFixed(2)}%</span></td>
                              <td>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", alignItems: "flex-start" }}>
                                  {tweet.tweetId ? (
                                    <a className="view-link" href={`https://x.com/i/web/status/${tweet.tweetId}`} target="_blank" rel="noopener noreferrer">
                                      View on X &#8599;
                                    </a>
                                  ) : tweet.threadsPostId ? (
                                    <span className="view-link" style={{ opacity: 0.5 }}>Threads</span>
                                  ) : (
                                    <span style={{ color: "var(--text-faint)" }}>—</span>
                                  )}
                                  {tweet.trackedUrl ? (
                                    <a className="view-link" href={tweet.trackedUrl} target="_blank" rel="noopener noreferrer">
                                      Test link &#8599;
                                    </a>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr><td colSpan={campaignSlug ? 10 : 11} className="empty-state">No posts yet. Run the bot to see results here.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="right-stack">
              <div className="card">
                <div className="card-header"><h3>Engagement breakdown</h3></div>
                <div className="engagement-list">
                  {engRows.map((row) => (
                    <div className="eng-row" key={row.label}>
                      <div className="eng-icon" style={{ background: row.bg, color: row.color }}>{row.icon}</div>
                      <span className="eng-label">{row.label}</span>
                      <div className="eng-bar-wrap"><div className="eng-bar-fill" style={{ width: `${row.pct}%`, background: row.color }} /></div>
                      <span className="eng-count">{compact(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Summary</h3></div>
                <div className="summary-list">
                  <div className="summary-row"><span className="summary-label">Total impressions</span><span className="summary-val green">{compact(totalImpressions)}</span></div>
                  <div className="summary-row"><span className="summary-label">Total engagement</span><span className="summary-val blue">{compact(totalEngagements)}</span></div>
                  <div className="summary-row"><span className="summary-label">Engagement rate</span><span className="summary-val">{avgRate.toFixed(2)}%</span></div>
                  <div className="summary-row"><span className="summary-label">X posts</span><span className="summary-val">{compact(xPosts)}</span></div>
                  <div className="summary-row"><span className="summary-label">Threads followers</span><span className="summary-val amber">{threadFollowers === null ? "—" : compact(threadFollowers)}</span></div>
                  <div className="summary-row"><span className="summary-label">Threads posts</span><span className="summary-val">{compact(threadsPosts)}</span></div>
                  <div className="summary-row"><span className="summary-label">Link clicks</span><span className="summary-val amber">{totalClicks === null ? "—" : compact(totalClicks)}</span></div>
                </div>
                <div className="card-footer">{store.updatedAt ? `Updated ${lastUpdated}` : "Awaiting analytics"}</div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Winning content patterns</h3></div>
                <div className="summary-list">
                  <div className="summary-row"><span className="summary-label">Top frame</span><span className="summary-val">{topFrame ? `${topFrame[0]} (${topFrame[1]})` : "—"}</span></div>
                  <div className="summary-row"><span className="summary-label">Top hook</span><span className="summary-val blue">{topHook ? `${topHook[0]} (${topHook[1]})` : "—"}</span></div>
                  <div className="summary-row"><span className="summary-label">Overused opener</span><span className="summary-val amber">{overusedOpener && overusedOpener[1] > 1 ? `${overusedOpener[0]} (${overusedOpener[1]})` : "None"}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
