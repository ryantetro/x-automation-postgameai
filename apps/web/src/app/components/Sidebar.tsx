import Link from "next/link";
import { loadStore, sportClass, shortDay, compact } from "../lib/data";

interface SidebarProps {
  activePage: "dashboard" | "analytics" | "posts";
}

export default async function Sidebar({ activePage }: SidebarProps) {
  const store = await loadStore();
  const tracked = store.tweets
    .filter((t) => t.status === "posted" && !!t.metrics)
    .sort((a, b) => (b.metrics?.impressionCount ?? 0) - (a.metrics?.impressionCount ?? 0))
    .slice(0, 6);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">X</div>
        <div className="brand-text">
          <h1>PostGame AI</h1>
          <span>Social Automation Dashboard</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link href="/" className={activePage === "dashboard" ? "active" : ""}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          Dashboard
        </Link>
        <Link href="/analytics" className={activePage === "analytics" ? "active" : ""}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 20V10M6 20V4M18 20v-6" strokeLinecap="round" />
          </svg>
          Analytics
        </Link>
        <Link href="/posts" className={activePage === "posts" ? "active" : ""}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          Posts
        </Link>
      </nav>

      <div className="sidebar-divider" />
      <div className="sidebar-section-label">Top performing</div>

      {tracked.length > 0 ? (
        tracked.map((tweet) => {
          const imp = tweet.metrics?.impressionCount ?? 0;
          return (
            <div className="top-post-item" key={tweet.runId}>
              <div className={`top-post-badge ${sportClass(tweet.sport)}`}>{tweet.sport.slice(0, 3)}</div>
              <div className="top-post-info">
                <p className="label">{tweet.sport} &middot; {shortDay(tweet.postedAt)}</p>
                <p className="sub">{compact(imp)} views / impressions</p>
              </div>
              <span className="top-post-metric">{compact(imp)}</span>
            </div>
          );
        })
      ) : (
        <div className="top-post-item">
          <div className="top-post-badge default">—</div>
          <div className="top-post-info">
            <p className="label">No data yet</p>
            <p className="sub">Run the bot to see stats</p>
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <div>
            <span className="pulse" />
            <strong>Bot active</strong>
          </div>
          <p>Posting 2x daily &middot; Refresh for latest</p>
        </div>
      </div>
    </aside>
  );
}
