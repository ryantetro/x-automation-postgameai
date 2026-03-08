import { loadStore, compact, sportClass, safeDate, lastUpdatedStr } from "./lib/data";
import Sidebar from "./components/Sidebar";
import InteractiveTimelineChart from "./components/InteractiveTimelineChart";

export const dynamic = "force-dynamic";

export default async function Home() {
  const store = await loadStore();

  const posted = store.tweets.filter((t) => t.status === "posted").sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  const recent = posted.slice(-12).reverse();
  const tracked = posted.filter((t) => !!t.metrics);

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
  const clickThroughRate = totalImpressions > 0 && totalClicks !== null ? (totalClicks / totalImpressions) * 100 : null;
  const threadFollowers = store.threadsUserInsights?.followersCount ?? null;
  const threadProfileViews = store.threadsUserInsights?.views ?? null;

  const engMax = Math.max(totalLikes, totalRetweets, totalReplies, totalBookmarks, totalShares, 1);
  const engRows = [
    { label: "Likes", icon: "♥", value: totalLikes, pct: (totalLikes / engMax) * 100, color: "var(--red)", bg: "rgba(239,68,68,0.12)" },
    { label: "Reposts / RTs", icon: "↻", value: totalRetweets, pct: (totalRetweets / engMax) * 100, color: "var(--accent)", bg: "rgba(34,197,94,0.12)" },
    { label: "Replies", icon: "↩", value: totalReplies, pct: (totalReplies / engMax) * 100, color: "var(--blue)", bg: "rgba(59,130,246,0.12)" },
    { label: "Bookmarks", icon: "⚑", value: totalBookmarks, pct: (totalBookmarks / engMax) * 100, color: "var(--amber)", bg: "rgba(245,158,11,0.12)" },
    { label: "Shares", icon: "⇪", value: totalShares, pct: (totalShares / engMax) * 100, color: "var(--text)", bg: "rgba(148,163,184,0.16)" },
  ].sort((a, b) => b.value - a.value);

  const lastUpdated = lastUpdatedStr(store.updatedAt);
  return (
    <div className="dash">
      <Sidebar activePage="dashboard" />
      <main className="main">
        <header className="header">
          <div className="header-left">
            <h2>Dashboard</h2>
            <span>{posted.length} posts &middot; {tracked.length} with metrics</span>
          </div>
          <div className="header-right">
            <span className="header-badge">{store.updatedAt ? `Updated ${lastUpdated}` : "Awaiting live analytics"}</span>
          </div>
        </header>

        <div className="content">
          <div className="stat-grid">
            <div className="stat-card green">
              <div className="stat-label">Total views / impressions</div>
              <div className="stat-value">{compact(totalImpressions)}</div>
              <div className="stat-sub">Across {tracked.length} tracked posts</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-label">Total engagement</div>
              <div className="stat-value stat-value-blue">{compact(totalEngagements)}</div>
              <div className="stat-sub">Likes + reposts + replies + quotes</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Threads followers</div>
              <div className="stat-value">{threadFollowers === null ? "—" : compact(threadFollowers)}</div>
              <div className="stat-sub">{threadProfileViews === null ? "No Threads profile views yet" : `${compact(threadProfileViews)} profile views`}</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Avg. engagement rate</div>
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
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <InteractiveTimelineChart
                records={posted.map((tweet) => ({
                  runId: tweet.runId,
                  postedAt: tweet.postedAt,
                  sport: tweet.sport,
                  angle: tweet.angle,
                  tweetId: tweet.tweetId,
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
                        <th>Sport</th>
                        <th>Date</th>
                        <th>Impressions</th>
                        <th>Clicks</th>
                        <th>Likes</th>
                        <th>Reposts / RTs</th>
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
                              <td><span className={`sport-pill ${sportClass(tweet.sport)}`}>{tweet.sport}</span></td>
                              <td>{safeDate(tweet.postedAt)}</td>
                              <td>{compact(imp)}</td>
                              <td>{typeof clicks === "number" ? compact(clicks) : "—"}</td>
                              <td>{compact(m?.likeCount ?? 0)}</td>
                              <td>{compact(m?.retweetCount ?? 0)}</td>
                              <td><span className={`rate-badge ${engRate > 0 ? "positive" : "zero"}`}>{engRate.toFixed(2)}%</span></td>
                              <td>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-start" }}>
                                  {tweet.tweetId ? (
                                    <a className="view-link" href={`https://x.com/i/web/status/${tweet.tweetId}`} target="_blank" rel="noopener noreferrer">
                                      View on X &#8599;
                                    </a>
                                  ) : tweet.threadsPostId ? (
                                    <span className="view-link" style={{ opacity: 0.7 }}>Threads posted</span>
                                  ) : (
                                    <span style={{ color: "var(--text-secondary)" }}>—</span>
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
                        <tr><td colSpan={8} className="empty-state">No posts yet. Run the bot to see results here.</td></tr>
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
                  <div className="summary-row"><span className="summary-label">Total views / impressions</span><span className="summary-val green">{compact(totalImpressions)}</span></div>
                  <div className="summary-row"><span className="summary-label">Total engagement</span><span className="summary-val blue">{compact(totalEngagements)}</span></div>
                  <div className="summary-row"><span className="summary-label">Avg. engagement rate</span><span className="summary-val">{avgRate.toFixed(2)}%</span></div>
                  <div className="summary-row"><span className="summary-label">Threads followers</span><span className="summary-val amber">{threadFollowers === null ? "—" : compact(threadFollowers)}</span></div>
                  <div className="summary-row"><span className="summary-label">Tracked link clicks</span><span className="summary-val amber">{totalClicks === null ? "—" : compact(totalClicks)}</span></div>
                  <div className="summary-row"><span className="summary-label">Click-through rate</span><span className="summary-val">{clickThroughRate === null ? "—" : `${clickThroughRate.toFixed(2)}%`}</span></div>
                </div>
                <div className="card-footer">{store.updatedAt ? `Updated ${lastUpdated}` : "Awaiting live analytics"}</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
