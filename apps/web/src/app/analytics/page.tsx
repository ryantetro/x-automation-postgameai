import { loadStore, compact, sportClass, lastUpdatedStr, frameLabel, hookLabel, frameClass } from "../lib/data";
import Sidebar from "../components/Sidebar";
import InteractiveAnalyticsChart from "../components/InteractiveAnalyticsChart";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ campaign?: string }> }) {
  const params = await searchParams;
  const campaignSlug = params.campaign;
  const store = await loadStore({ campaignSlug });

  const posted = store.tweets.filter((t) => t.status === "posted").sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  const tracked = posted.filter((t) => !!t.metrics);
  const xPosts = posted.filter((t) => !!t.tweetId).length;
  const threadsPosts = posted.filter((t) => !!t.threadsPostId).length;
  const byPlatform = {
    x: posted.filter((t) => !!t.tweetId),
    threads: posted.filter((t) => !!t.threadsPostId),
  };

  const totalImpressions = tracked.reduce((s, t) => s + (t.metrics?.impressionCount ?? 0), 0);
  const totalEngagements = tracked.reduce((s, t) => s + (t.metrics?.engagementCount ?? 0), 0);
  const totalLikes = tracked.reduce((s, t) => s + (t.metrics?.likeCount ?? 0), 0);
  const totalBookmarks = tracked.reduce((s, t) => s + (t.metrics?.bookmarkCount ?? 0), 0);
  const totalQuotes = tracked.reduce((s, t) => s + (t.metrics?.quoteCount ?? 0), 0);
  const totalShares = tracked.reduce((s, t) => s + (t.metrics?.shareCount ?? 0), 0);
  const hasClickMetrics = posted.some((t) => !!t.clickMetrics);
  const totalClicks = hasClickMetrics ? posted.reduce((s, t) => s + (t.clickMetrics?.totalClicks ?? 0), 0) : null;
  const clickThroughRate = totalImpressions > 0 && totalClicks !== null ? (totalClicks / totalImpressions) * 100 : null;
  const avgImpPerPost = tracked.length > 0 ? totalImpressions / tracked.length : 0;
  const avgEngPerPost = tracked.length > 0 ? totalEngagements / tracked.length : 0;
  const threadFollowers = store.threadsUserInsights?.followersCount ?? null;
  const threadProfileViews = store.threadsUserInsights?.views ?? null;

  const chartPosts = posted.slice(-30).map((t) => ({
    postedAt: t.postedAt,
    sport: t.sport,
    angle: t.angle,
    impressions: t.metrics?.impressionCount ?? 0,
    engagements: t.metrics?.engagementCount ?? 0,
    likes: t.metrics?.likeCount ?? 0,
    retweets: t.metrics?.retweetCount ?? 0,
    replies: t.metrics?.replyCount ?? 0,
    bookmarks: t.metrics?.bookmarkCount ?? 0,
  }));

  const sportMap = new Map<string, { posts: number; impressions: number; engagements: number; likes: number; retweets: number }>();
  for (const t of posted) {
    const key = t.sport.toLowerCase();
    const prev = sportMap.get(key) ?? { posts: 0, impressions: 0, engagements: 0, likes: 0, retweets: 0 };
    prev.posts++;
    if (t.metrics) {
      prev.impressions += t.metrics.impressionCount ?? 0;
      prev.engagements += t.metrics.engagementCount ?? 0;
      prev.likes += t.metrics.likeCount ?? 0;
      prev.retweets += t.metrics.retweetCount ?? 0;
    }
    sportMap.set(key, prev);
  }
  const sportRows = [...sportMap.entries()]
    .map(([sport, d]) => ({ sport, ...d, rate: d.impressions > 0 ? (d.engagements / d.impressions) * 100 : 0 }))
    .sort((a, b) => b.impressions - a.impressions);
  const maxSportImp = Math.max(...sportRows.map((r) => r.impressions), 1);

  const angleMap = new Map<string, { count: number; impressions: number }>();
  for (const t of posted) {
    const key = t.angle || "unknown";
    const prev = angleMap.get(key) ?? { count: 0, impressions: 0 };
    prev.count++;
    prev.impressions += t.metrics?.impressionCount ?? 0;
    angleMap.set(key, prev);
  }
  const angleRows = [...angleMap.entries()]
    .map(([angle, d]) => ({ angle, ...d, avgImp: d.count > 0 ? d.impressions / d.count : 0 }))
    .sort((a, b) => b.avgImp - a.avgImp)
    .slice(0, 8);
  const maxAngleImp = Math.max(...angleRows.map((r) => r.avgImp), 1);

  const dayMap = new Map<string, number>();
  for (const t of posted) {
    const d = new Date(t.postedAt);
    if (!Number.isNaN(d.getTime())) {
      const key = d.toLocaleDateString("en-US", { weekday: "short" });
      dayMap.set(key, (dayMap.get(key) ?? 0) + 1);
    }
  }
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayData = days.map((d) => ({ day: d, count: dayMap.get(d) ?? 0 }));
  const maxDay = Math.max(...dayData.map((d) => d.count), 1);

  const lastUpdated = lastUpdatedStr(store.updatedAt);

  const frameRows = [...new Map(
    posted
      .filter((t) => t.contentFrameId)
      .map((tweet) => {
        const label = frameLabel(tweet);
        return [label, {
          label,
          frameId: tweet.contentFrameId!,
          count: posted.filter((row) => frameLabel(row) === label).length,
          avgImp: Math.round(
            posted.filter((row) => frameLabel(row) === label).reduce((sum, row) => sum + (row.metrics?.impressionCount ?? 0), 0) /
            Math.max(1, posted.filter((row) => frameLabel(row) === label).length)
          ),
        }];
      })
  ).values()].sort((a, b) => b.avgImp - a.avgImp);

  const hookRows = [...new Map(
    posted
      .filter((t) => t.hookStructureId)
      .map((tweet) => {
        const label = hookLabel(tweet);
        return [label, {
          label,
          count: posted.filter((row) => hookLabel(row) === label).length,
          avgScore:
            posted.filter((row) => hookLabel(row) === label).reduce((sum, row) => sum + (row.score ?? 0), 0) /
            Math.max(1, posted.filter((row) => hookLabel(row) === label).length),
        }];
      })
  ).values()].sort((a, b) => b.avgScore - a.avgScore);

  const emotionRows = [...new Map(
    posted
      .filter((t) => t.emotionTarget)
      .map((tweet) => [
        tweet.emotionTarget!,
        {
          emotion: tweet.emotionTarget!,
          count: posted.filter((row) => row.emotionTarget === tweet.emotionTarget).length,
          avgScore:
            posted.filter((row) => row.emotionTarget === tweet.emotionTarget).reduce((sum, row) => sum + (row.score ?? 0), 0) /
            Math.max(1, posted.filter((row) => row.emotionTarget === tweet.emotionTarget).length),
        },
      ])
  ).values()].sort((a, b) => b.avgScore - a.avgScore);

  const platformFrameRows = (["x", "threads"] as const).flatMap((platform) => {
    const rows = byPlatform[platform];
    const frames = [...new Set(rows.map((row) => row.contentFrameId).filter(Boolean))];
    return frames.map((frameId) => {
      const records = rows.filter((row) => row.contentFrameId === frameId);
      return {
        platform,
        frameId: frameId!,
        label: frameLabel(records[0]!),
        count: records.length,
        avgScore: records.reduce((sum, row) => sum + (row.score ?? 0), 0) / Math.max(1, records.length),
      };
    });
  }).sort((a, b) => b.avgScore - a.avgScore);

  return (
    <div className="dash">
      <Sidebar activePage="analytics" campaignSlug={campaignSlug} />
      <main className="main">
        <header className="header">
          <div className="header-left">
            <span className="page-kicker">{store.activeCampaign ? store.activeCampaign.name : "All campaigns"}</span>
            <h2>Analytics</h2>
            <span>{store.activeCampaign ? `${store.activeCampaign.name} performance` : "Cross-platform posting performance"}</span>
          </div>
          <div className="header-right">
            <span className="header-badge">{xPosts} X posts</span>
            <span className="header-badge">{threadsPosts} Threads</span>
            <span className="header-badge">{store.updatedAt ? `Updated ${lastUpdated}` : "Awaiting data"}</span>
          </div>
        </header>

        <div className="content">
          <div className="stat-grid">
            <div className="stat-card green">
              <div className="stat-label">Avg. impressions / post</div>
              <div className="stat-value">{compact(avgImpPerPost)}</div>
              <div className="stat-sub">{tracked.length} tracked posts</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-label">Avg. engagement / post</div>
              <div className="stat-value stat-value-blue">{compact(avgEngPerPost)}</div>
              <div className="stat-sub">Likes + reposts + replies + quotes</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Threads followers</div>
              <div className="stat-value">{threadFollowers === null ? "—" : compact(threadFollowers)}</div>
              <div className="stat-sub">{threadProfileViews === null ? "No profile views yet" : `${compact(threadProfileViews)} profile views`}</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Click-through rate</div>
              <div className="stat-value">{clickThroughRate === null ? "—" : `${clickThroughRate.toFixed(2)}%`}</div>
              <div className="stat-sub">{compact(totalLikes)} likes &middot; {compact(totalShares)} shares &middot; {compact(totalQuotes)} quotes &middot; {compact(totalBookmarks)} bookmarks</div>
            </div>
          </div>

          <div className="analytics-charts">
            <div className="card">
              <div className="card-header">
                <div><h3>Impressions trend</h3><span className="card-sub">Last {chartPosts.length} posts</span></div>
                <span className="card-sub">{compact(totalImpressions)} total</span>
              </div>
              <InteractiveAnalyticsChart
                posts={chartPosts}
                metric="impressions"
                color="#10b981"
                gradientStart="rgba(16, 185, 129, 0.2)"
                gradientEnd="rgba(16, 185, 129, 0)"
                total={totalImpressions}
              />
            </div>

            <div className="card">
              <div className="card-header">
                <div><h3>Engagement trend</h3><span className="card-sub">Last {chartPosts.length} posts</span></div>
                <span className="card-sub">{compact(totalEngagements)} total</span>
              </div>
              <InteractiveAnalyticsChart
                posts={chartPosts}
                metric="engagements"
                color="#3b82f6"
                gradientStart="rgba(59, 130, 246, 0.2)"
                gradientEnd="rgba(59, 130, 246, 0)"
                total={totalEngagements}
              />
            </div>
          </div>

          <div className="analytics-bottom">
            <div className="card">
              <div className="card-header"><h3>Performance by sport</h3></div>
              <div style={{ overflowX: "auto" }}>
                <table className="posts-table">
                  <thead>
                    <tr>
                      <th>Sport</th>
                      <th>Posts</th>
                      <th>Impressions</th>
                      <th>Engagements</th>
                      <th>Eng. rate</th>
                      <th style={{ width: "28%" }}>Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sportRows.map((row) => (
                      <tr key={row.sport}>
                        <td><span className={`sport-pill ${sportClass(row.sport)}`}>{row.sport}</span></td>
                        <td>{row.posts}</td>
                        <td>{compact(row.impressions)}</td>
                        <td>{compact(row.engagements)}</td>
                        <td><span className={`rate-badge ${row.rate > 0 ? "positive" : "zero"}`}>{row.rate.toFixed(2)}%</span></td>
                        <td>
                          <div className="inline-bar-wrap">
                            <div className="inline-bar-fill" style={{ width: `${(row.impressions / maxSportImp) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {sportRows.length === 0 && (
                      <tr><td colSpan={6} className="empty-state">No data yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="analytics-side-stack">
              <div className="card">
                <div className="card-header"><h3>Performance by frame</h3><span className="card-sub">Avg. impressions</span></div>
                <div className="angle-list">
                  {frameRows.map((row) => (
                    <div className="angle-row" key={row.label}>
                      <span className={`frame-pill ${frameClass(row.frameId)}`}>{row.label}</span>
                      <div className="angle-info">
                        <span className="angle-name">{row.count} posts</span>
                        <span className="angle-sub">{compact(row.avgImp)} avg impressions</span>
                      </div>
                    </div>
                  ))}
                  {frameRows.length === 0 && <div className="empty-state">No frame data yet</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Performance by hook</h3><span className="card-sub">Avg. score</span></div>
                <div className="angle-list">
                  {hookRows.map((row) => (
                    <div className="angle-row" key={row.label}>
                      <span className="hook-pill">{row.label}</span>
                      <div className="angle-info">
                        <span className="angle-name">{row.count} posts</span>
                        <span className="angle-sub">{row.avgScore.toFixed(2)} avg score</span>
                      </div>
                    </div>
                  ))}
                  {hookRows.length === 0 && <div className="empty-state">No hook data yet</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Emotion signal</h3><span className="card-sub">What is landing</span></div>
                <div className="angle-list">
                  {emotionRows.map((row) => (
                    <div className="angle-row" key={row.emotion}>
                      <span className="hook-pill">{row.emotion}</span>
                      <div className="angle-info">
                        <span className="angle-name">{row.count} posts</span>
                        <span className="angle-sub">{row.avgScore.toFixed(2)} avg score</span>
                      </div>
                    </div>
                  ))}
                  {emotionRows.length === 0 && <div className="empty-state">No emotion data yet</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Platform x frame</h3><span className="card-sub">Shared architecture, separate weighting</span></div>
                <div style={{ overflowX: "auto" }}>
                  <table className="posts-table">
                    <thead>
                      <tr>
                        <th>Platform</th>
                        <th>Frame</th>
                        <th>Posts</th>
                        <th>Avg. score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platformFrameRows.map((row) => (
                        <tr key={`${row.platform}-${row.frameId}`}>
                          <td><span className={`platform-pill ${row.platform}`}>{row.platform.toUpperCase()}</span></td>
                          <td><span className={`frame-pill ${frameClass(row.frameId)}`}>{row.label}</span></td>
                          <td>{row.count}</td>
                          <td>{row.avgScore.toFixed(2)}</td>
                        </tr>
                      ))}
                      {platformFrameRows.length === 0 && (
                        <tr><td colSpan={4} className="empty-state">No platform/frame data yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Top angles</h3><span className="card-sub">By avg. impressions</span></div>
                <div className="angle-list">
                  {angleRows.map((row, i) => (
                    <div className="angle-row" key={row.angle}>
                      <span className="angle-rank">#{i + 1}</span>
                      <div className="angle-info">
                        <span className="angle-name">{row.angle}</span>
                        <span className="angle-sub">{row.count} posts &middot; {compact(row.impressions)} total</span>
                      </div>
                      <div className="angle-bar-wrap">
                        <div className="angle-bar-fill" style={{ width: `${(row.avgImp / maxAngleImp) * 100}%` }} />
                      </div>
                      <span className="angle-val">{compact(row.avgImp)}</span>
                    </div>
                  ))}
                  {angleRows.length === 0 && <div className="empty-state">No data yet</div>}
                </div>
              </div>

              <div className="card">
                <div className="card-header"><h3>Posting frequency</h3><span className="card-sub">By day of week</span></div>
                <div className="freq-chart">
                  {dayData.map((d) => (
                    <div className="freq-col" key={d.day}>
                      <div className="freq-bar-track">
                        <div className="freq-bar" style={{ height: `${(d.count / maxDay) * 100}%` }} />
                      </div>
                      <span className="freq-label">{d.day}</span>
                      <span className="freq-count">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
