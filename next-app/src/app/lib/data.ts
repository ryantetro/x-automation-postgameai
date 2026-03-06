import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type TweetStatus = "posted" | "dry_run" | "failed";

export interface TweetMetricsSnapshot {
  fetchedAt: string;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  quoteCount: number;
  bookmarkCount: number;
  impressionCount: number | null;
  engagementCount: number;
  engagementRate: number | null;
}

export interface TweetAnalyticsRecord {
  runId: string;
  tweetId?: string;
  postedAt: string;
  dateContext: string;
  sport: string;
  angle: string;
  source: string;
  status: TweetStatus;
  text: string;
  metrics?: TweetMetricsSnapshot;
  score?: number;
  scoreUpdatedAt?: string;
}

export interface AnalyticsStore {
  version: number;
  updatedAt: string;
  tweets: TweetAnalyticsRecord[];
}

const BOT_STATE_FILE = resolve(process.cwd(), "..", "postgame-x-bot", "state", "tweet-analytics.json");
const REMOTE_STATE_URL =
  process.env.ANALYTICS_JSON_URL ??
  "https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/postgame-x-bot/state/tweet-analytics.json";

export async function loadStore(): Promise<AnalyticsStore> {
  try {
    const r = await fetch(REMOTE_STATE_URL, { cache: "no-store" });
    if (r.ok) {
      const p = (await r.json()) as Partial<AnalyticsStore>;
      if (Array.isArray(p.tweets))
        return { version: p.version ?? 1, updatedAt: p.updatedAt ?? new Date().toISOString(), tweets: p.tweets };
    }
  } catch {
    /* fallback */
  }

  if (existsSync(BOT_STATE_FILE)) {
    try {
      const p = JSON.parse(await readFile(BOT_STATE_FILE, "utf-8")) as Partial<AnalyticsStore>;
      if (Array.isArray(p.tweets))
        return { version: p.version ?? 1, updatedAt: p.updatedAt ?? new Date().toISOString(), tweets: p.tweets };
    } catch {
      /* ignore */
    }
  }

  return { version: 1, updatedAt: new Date().toISOString(), tweets: [] };
}

export function safeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function shortDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { day: "2-digit", month: "short" }).toLowerCase();
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function linePath(values: number[], w: number, h: number): { line: string; area: string } {
  if (!values.length) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pts = values.map((v, i) => ({
    x: (i / Math.max(values.length - 1, 1)) * w,
    y: h - ((v - min) / span) * h,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${w},${h} L0,${h}Z` };
}

export function sportClass(sport: string): string {
  const s = sport.toLowerCase();
  if (s === "nfl") return "nfl";
  if (s === "nba") return "nba";
  if (s === "mlb") return "mlb";
  if (s === "soccer") return "soccer";
  return "default";
}

export function lastUpdatedStr(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
