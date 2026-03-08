import {
  loadStore,
  compact,
  safeDate,
  sportClass,
  lastUpdatedStr,
  platformClass,
  platformLabel,
  frameLabel,
  hookLabel,
  frameClass,
} from "../lib/data";
import Sidebar from "../components/Sidebar";

export const dynamic = "force-dynamic";

export default async function PostsPage() {
  const store = await loadStore();

  const allPosts = store.tweets
    .filter((t) => t.status === "posted")
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));

  const totalPosts = allPosts.length;
  const withMetrics = allPosts.filter((t) => !!t.metrics).length;
  const published = allPosts.filter((t) => !!t.tweetId || !!t.threadsPostId).length;
  const trackedLinks = allPosts.filter((t) => !!t.trackedUrl).length;
  const xPosts = allPosts.filter((t) => !!t.tweetId).length;
  const threadsPosts = allPosts.filter((t) => !!t.threadsPostId).length;

  const sports = [...new Set(allPosts.map((t) => t.sport.toLowerCase()))];

  const lastUpdated = lastUpdatedStr(store.updatedAt);

  return (
    <div className="dash">
      <Sidebar activePage="posts" />
      <main className="main">
        <header className="header">
          <div className="header-left">
            <span className="page-kicker">Publishing archive</span>
            <h2>Posts</h2>
            <span>All automated posts published by the bot</span>
          </div>
          <div className="header-right">
            <span className="header-badge">{xPosts} on X</span>
            <span className="header-badge">{threadsPosts} on Threads</span>
            <span className="header-badge">{store.updatedAt ? `Updated ${lastUpdated}` : "Awaiting data"}</span>
          </div>
        </header>

        <div className="content">
          <div className="stat-grid stat-grid-three">
            <div className="stat-card green">
              <div className="stat-label">Total posts</div>
              <div className="stat-value">{totalPosts}</div>
              <div className="stat-sub">{published} published across platforms</div>
            </div>
            <div className="stat-card blue">
              <div className="stat-label">Platform split</div>
              <div className="stat-value stat-value-blue">{xPosts} / {threadsPosts}</div>
              <div className="stat-sub">X vs Threads volume</div>
            </div>
            <div className="stat-card amber">
              <div className="stat-label">Coverage</div>
              <div className="stat-value">{withMetrics}</div>
              <div className="stat-sub">{trackedLinks} tracked links &middot; {sports.join(", ") || "—"}</div>
            </div>
          </div>

          <div className="post-feed">
            {allPosts.length > 0 ? (
              allPosts.map((tweet) => {
                const m = tweet.metrics;
                const imp = m?.impressionCount ?? 0;
                const engRate = m?.engagementRate ?? (imp > 0 && m ? (m.engagementCount / imp) * 100 : 0);
                const clicks = tweet.clickMetrics?.totalClicks;
                const uniqueClicks = tweet.clickMetrics?.uniqueClicks;

                return (
                  <article className="post-card" key={tweet.runId}>
                    <div className="post-card-top">
                      <span className={`sport-pill ${sportClass(tweet.sport)}`}>{tweet.sport}</span>
                      <span className={`platform-pill ${platformClass(tweet)}`}>{platformLabel(tweet)}</span>
                      <span className={`frame-pill ${frameClass(tweet.contentFrameId)}`}>{frameLabel(tweet)}</span>
                      {tweet.hookStructureId ? <span className="hook-pill">{hookLabel(tweet)}</span> : null}
                      <span className="post-card-date">{safeDate(tweet.postedAt)}</span>
                      <span className="post-card-angle">{tweet.angle}</span>
                      {tweet.tweetId && (
                        <a
                          className="view-link post-card-link"
                          href={`https://x.com/i/web/status/${tweet.tweetId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on X &#8599;
                        </a>
                      )}
                      {!tweet.tweetId && tweet.threadsPostId && (
                        <span className="view-link post-card-link" style={{ opacity: 0.5 }}>
                          Threads
                        </span>
                      )}
                      {tweet.trackedUrl && (
                        <a
                          className="view-link post-card-link"
                          href={tweet.trackedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Test link &#8599;
                        </a>
                      )}
                    </div>

                    <p className="post-card-text">{tweet.text}</p>

                    {m && (
                      <div className="post-card-metrics">
                        <div className="pcm">
                          <span className="pcm-val">{compact(imp)}</span>
                          <span className="pcm-label">Impressions</span>
                        </div>
                        <div className="pcm">
                          <span className="pcm-val">{compact(m.likeCount)}</span>
                          <span className="pcm-label">Likes</span>
                        </div>
                        <div className="pcm">
                          <span className="pcm-val">{compact(m.retweetCount)}</span>
                          <span className="pcm-label">Reposts</span>
                        </div>
                        <div className="pcm">
                          <span className="pcm-val">{compact(m.replyCount)}</span>
                          <span className="pcm-label">Replies</span>
                        </div>
                        <div className="pcm">
                          <span className="pcm-val">{compact(m.bookmarkCount)}</span>
                          <span className="pcm-label">Bookmarks</span>
                        </div>
                        <div className="pcm">
                          <span className="pcm-val">{compact(m.shareCount ?? 0)}</span>
                          <span className="pcm-label">Shares</span>
                        </div>
                        <div className="pcm">
                          <span className="pcm-val pcm-amber">{typeof clicks === "number" ? compact(clicks) : "—"}</span>
                          <span className="pcm-label">Clicks</span>
                        </div>
                        <div className="pcm">
                          <span className={`pcm-val ${engRate > 0 ? "pcm-green" : ""}`}>{engRate.toFixed(2)}%</span>
                          <span className="pcm-label">Eng. rate</span>
                        </div>
                      </div>
                    )}

                    {!m && (
                      <div className="post-card-no-metrics">
                        {tweet.trackedUrl
                          ? typeof clicks === "number" && typeof uniqueClicks === "number"
                            ? `${compact(clicks)} clicks · ${compact(uniqueClicks)} unique visitors`
                            : "Click analytics unavailable"
                          : "No metrics collected yet"}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="empty-state">No posts yet. Run the bot to see results here.</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
