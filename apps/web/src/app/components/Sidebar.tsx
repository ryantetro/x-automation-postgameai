import Link from "next/link";
import { loadStore, sportClass, shortDay, compact, lastUpdatedStr } from "../lib/data";
import CampaignSelector from "./CampaignSelector";

interface SidebarProps {
  activePage: "dashboard" | "analytics" | "posts";
  campaignSlug?: string;
}

export default async function Sidebar({ activePage, campaignSlug }: SidebarProps) {
  const store = await loadStore({ campaignSlug });
  const posted = store.tweets.filter((t) => t.status === "posted");
  const tracked = store.tweets
    .filter((t) => t.status === "posted" && !!t.metrics)
    .sort((a, b) => (b.metrics?.impressionCount ?? 0) - (a.metrics?.impressionCount ?? 0))
    .slice(0, 5);
  const xPosts = posted.filter((t) => !!t.tweetId).length;
  const threadsPosts = posted.filter((t) => !!t.threadsPostId).length;
  const lastUpdated = lastUpdatedStr(store.updatedAt);

  const qs = campaignSlug ? `?campaign=${campaignSlug}` : "";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">
          <span>CC</span>
        </div>
        <div className="brand-text">
          <span className="brand-kicker">Social Bot</span>
          <h1>Control Center</h1>
        </div>
      </div>

      <CampaignSelector
        campaigns={store.campaigns}
        activeCampaign={campaignSlug ?? null}
        currentPath={activePage === "dashboard" ? "/" : `/${activePage}`}
      />

      <nav className="sidebar-nav">
        <Link href={`/${qs}`} className={activePage === "dashboard" ? "active" : ""}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          Dashboard
        </Link>
        <Link href={`/analytics${qs}`} className={activePage === "analytics" ? "active" : ""}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M12 20V10M6 20V4M18 20v-6" strokeLinecap="round" />
          </svg>
          Analytics
        </Link>
        <Link href={`/posts${qs}`} className={activePage === "posts" ? "active" : ""}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          Posts
        </Link>
      </nav>

      <div className="sidebar-overview">
        <div className="sidebar-overview-card">
          <span className="sidebar-overview-label">Published</span>
          <strong>{posted.length}</strong>
          <p>Posts tracked across platforms</p>
        </div>
        <div className="sidebar-mini-grid">
          <div className="sidebar-mini-card">
            <span>X</span>
            <strong>{xPosts}</strong>
          </div>
          <div className="sidebar-mini-card">
            <span>Threads</span>
            <strong>{threadsPosts}</strong>
          </div>
        </div>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section-head">
        <div className="sidebar-section-label">Top performing</div>
        <span className="sidebar-section-meta">{tracked.length}</span>
      </div>

      {tracked.length > 0 ? (
        tracked.map((tweet) => {
          const imp = tweet.metrics?.impressionCount ?? 0;
          return (
            <div className="top-post-item" key={tweet.runId}>
              <div className={`top-post-badge ${sportClass(tweet.sport)}`}>{tweet.sport.slice(0, 3)}</div>
              <div className="top-post-info">
                <p className="label">{tweet.sport} &middot; {shortDay(tweet.postedAt)}</p>
                <p className="sub">{compact(imp)} impressions</p>
              </div>
              <span className="top-post-metric">{compact(imp)}</span>
            </div>
          );
        })
      ) : (
        <div className="top-post-item">
          <div className="top-post-badge default">&mdash;</div>
          <div className="top-post-info">
            <p className="label">No data yet</p>
            <p className="sub">Run the bot to begin</p>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <div>
            <span className="pulse" />
            <strong>System online</strong>
          </div>
          <p>{store.updatedAt ? `Synced ${lastUpdated}` : "Awaiting data"}</p>
        </div>
      </div>
    </aside>
  );
}
