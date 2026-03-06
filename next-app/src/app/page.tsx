import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";

type TweetStatus = "posted" | "dry_run" | "failed";

interface TweetMetricsSnapshot {
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

interface TweetAnalyticsRecord {
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

interface AnalyticsStore {
  version: number;
  updatedAt: string;
  tweets: TweetAnalyticsRecord[];
}

const DASHBOARD_STATE_FILE = resolve(process.cwd(), "public", "tweet-analytics.json");
const BOT_STATE_FILE = resolve(process.cwd(), "..", "postgame-x-bot", "state", "tweet-analytics.json");
const REMOTE_STATE_URL =
  process.env.ANALYTICS_JSON_URL ??
  "https://raw.githubusercontent.com/ryantetro/x-automation-postgameai/main/postgame-x-bot/state/tweet-analytics.json";

function safeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { day: "2-digit", month: "short" }).toLowerCase();
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function trimText(text: string, max = 104): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function toDecimal(value: number, digits = 5): string {
  return value.toFixed(digits);
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function sparkLine(values: number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  return values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function areaLine(values: number[], width: number, height: number): { line: string; area: string } {
  const line = sparkLine(values, width, height);
  if (!line) return { line: "", area: "" };
  return {
    line,
    area: `${line} L ${width},${height} L 0,${height} Z`,
  };
}

async function loadStore(): Promise<AnalyticsStore> {
  try {
    const remote = await fetch(REMOTE_STATE_URL, { cache: "no-store" });
    if (remote.ok) {
      const parsed = (await remote.json()) as Partial<AnalyticsStore>;
      if (Array.isArray(parsed.tweets)) {
        return {
          version: typeof parsed.version === "number" ? parsed.version : 1,
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
          tweets: parsed.tweets,
        };
      }
    }
  } catch {
    // fallback to local copies
  }

  const candidates = [DASHBOARD_STATE_FILE, BOT_STATE_FILE];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const parsed = JSON.parse(await readFile(file, "utf-8")) as Partial<AnalyticsStore>;
      if (!Array.isArray(parsed.tweets)) continue;
      return {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        tweets: parsed.tweets,
      };
    } catch {
      // keep trying
    }
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tweets: [],
  };
}

export default async function Home() {
  const store = await loadStore();

  const posted = store.tweets
    .filter((tweet) => tweet.status === "posted")
    .sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));

  const tracked = posted.filter((tweet) => !!tweet.metrics);
  const recent = posted.slice(-8).reverse();

  const totalImpressions = tracked.reduce((sum, tweet) => sum + (tweet.metrics?.impressionCount ?? 0), 0);
  const totalEngagements = tracked.reduce((sum, tweet) => sum + (tweet.metrics?.engagementCount ?? 0), 0);
  const totalLikes = tracked.reduce((sum, tweet) => sum + (tweet.metrics?.likeCount ?? 0), 0);
  const avgEngagementRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;
  const avgScore =
    tracked.length > 0
      ? tracked.reduce((sum, tweet) => sum + (typeof tweet.score === "number" ? tweet.score : 0), 0) / tracked.length
      : 0;
  const activeCount = tracked.filter((tweet) => (tweet.metrics?.engagementCount ?? 0) > 0).length;

  const candleSeries = posted.slice(-40).map((tweet) => {
    const seed = hashSeed(tweet.runId);
    const base = (tweet.metrics?.impressionCount ?? 2) + (tweet.metrics?.engagementCount ?? 0) * 7;
    return Math.max(1, base + (seed % 9));
  });

  const lineSeries = posted.slice(-28).map((tweet) => {
    const seed = hashSeed(tweet.runId + tweet.text);
    const base = (tweet.metrics?.engagementRate ?? 0) * 100 + (tweet.metrics?.engagementCount ?? 0) * 0.5;
    return Math.max(0.1, base + (seed % 15) / 10);
  });

  const roiSeries = posted.slice(-16).map((tweet, i) => {
    const seed = hashSeed(`${tweet.runId}-${i}`);
    const score = typeof tweet.score === "number" ? tweet.score * 10 : 0;
    return Math.max(1, score + (tweet.metrics?.impressionCount ?? 0) * 0.1 + (seed % 8));
  });

  const candleMax = Math.max(...candleSeries, 1);

  const line = areaLine(lineSeries, 660, 210);
  const roi = areaLine(roiSeries, 660, 180);

  const ranked = tracked.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const hashtags = new Map<string, number>();
  for (const tweet of posted) {
    const tags = tweet.text.match(/#[a-z0-9_]+/gi) ?? [];
    for (const tag of tags) hashtags.set(tag.toUpperCase(), (hashtags.get(tag.toUpperCase()) ?? 0) + 1);
  }

  const marketRows = [...hashtags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag, c], idx) => {
    const base = 1.17 + idx * 0.0001;
    const spread = 0.00003 + c * 0.000002;
    return {
      symbol: tag,
      tx: `${c * (idx % 2 === 0 ? 1 : -1)}.${(c * 7) % 100}`,
      bid: toDecimal(base + spread, 5),
      ask: toDecimal(base + spread * 2, 5),
    };
  });

  const depthRows = ranked.slice(0, 5).map((tweet, idx) => {
    const imp = tweet.metrics?.impressionCount ?? 0;
    const bidSize = Math.max(1, Math.round((imp / 2 + 1) * (1 + idx * 0.1)));
    const askSize = Math.max(1, Math.round((imp / 2 + 1) * (1 + (4 - idx) * 0.08)));
    const mid = 1.1762 + idx * 0.00012;
    return {
      bidSize,
      askSize,
      bid: toDecimal(mid + 0.00003, 5),
      ask: toDecimal(mid + 0.00006, 5),
    };
  });

  const leftTicks = posted.slice(-6).map((tweet) => dayLabel(tweet.postedAt));

  return (
    <div className="trade-shell">
      <div className="trade-glow" aria-hidden="true" />
      <main className="trade-wrap">
        <section className="grid-top">
          <article className="card panel-candles">
            <div className="chip-row">
              <span className="chip active">Watchlists</span>
              <span className="chip">All symbols</span>
            </div>
            <div className="chart-shell candlestick-shell">
              <div className="candles-grid" />
              <div className="candles-track">
                {(candleSeries.length > 0 ? candleSeries : [4, 7, 6, 8, 6, 5, 7, 8, 6, 9]).map((value, idx) => {
                  const h = Math.max(8, Math.round((value / candleMax) * 100));
                  const seed = idx % 2 === 0;
                  return (
                    <div className="candle-stick" key={`c-${idx}`}>
                      <span className={`wick ${seed ? "up" : "down"}`} style={{ height: `${Math.max(30, h + 16)}%` }} />
                      <span className={`body ${seed ? "up" : "down"}`} style={{ height: `${h}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="axis-row">
                {leftTicks.length > 0 ? leftTicks.map((tick, idx) => <span key={`t-${idx}`}>{tick}</span>) : <span>no data</span>}
              </div>
            </div>
          </article>

          <article className="card panel-line">
            <div className="chip-row">
              <span className="chip active">XUSD</span>
            </div>
            <div className="chart-shell line-shell">
              <svg viewBox="0 0 660 240" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(0,255,151,0.38)" />
                    <stop offset="100%" stopColor="rgba(0,255,151,0.02)" />
                  </linearGradient>
                </defs>
                <path d={line.area} fill="url(#lineFill)" />
                <path d={line.line} fill="none" stroke="url(#lineStroke)" strokeWidth="3" strokeLinecap="round" />
                <defs>
                  <linearGradient id="lineStroke" x1="0" y1="0" x2="660" y2="0">
                    <stop offset="0%" stopColor="#1dffac" />
                    <stop offset="100%" stopColor="#4bd4ff" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="axis-row">
                {leftTicks.length > 0 ? leftTicks.map((tick, idx) => <span key={`l-${idx}`}>{tick}</span>) : <span>no data</span>}
              </div>
            </div>
          </article>
        </section>

        <section className="grid-middle">
          <article className="card roi-card">
            <h3>ROI (Monthly)</h3>
            <div className="roi-shell">
              <svg viewBox="0 0 660 220" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="roi-outer" x1="0" y1="0" x2="660" y2="0">
                    <stop offset="0%" stopColor="#6a2df8" />
                    <stop offset="100%" stopColor="#ff44be" />
                  </linearGradient>
                  <linearGradient id="roi-mid" x1="0" y1="0" x2="660" y2="0">
                    <stop offset="0%" stopColor="#8b35ff" />
                    <stop offset="100%" stopColor="#ff62be" />
                  </linearGradient>
                  <linearGradient id="roi-core" x1="0" y1="0" x2="660" y2="0">
                    <stop offset="0%" stopColor="#ff9179" />
                    <stop offset="100%" stopColor="#ffa15c" />
                  </linearGradient>
                </defs>
                <path d={roi.area} fill="url(#roi-outer)" opacity="0.55" transform="translate(0,8) scale(1,0.9)" />
                <path d={roi.area} fill="url(#roi-mid)" opacity="0.7" transform="translate(0,22) scale(1,0.72)" />
                <path d={roi.area} fill="url(#roi-core)" opacity="0.84" transform="translate(0,38) scale(1,0.54)" />
                <line x1="330" y1="0" x2="330" y2="220" stroke="rgba(255,255,255,0.26)" strokeWidth="1" />
              </svg>
              <span className="roi-dot">+{(avgEngagementRate * 30 + avgScore).toFixed(2)}%</span>
            </div>
          </article>

          <div className="trade-column">
            <article className="card trade-ticket">
              <header>
                <h3>X vs Market</h3>
                <span className="small-chip">auto</span>
              </header>
              <div className="tab-row">
                <button className="tab active" type="button">
                  Market
                </button>
                <button className="tab" type="button">
                  Limit
                </button>
                <button className="tab" type="button">
                  Both
                </button>
              </div>
              <div className="order-row sell">
                <span>sell</span>
                <strong>{toDecimal(1.176 + avgScore * 0.0004)}</strong>
                <em>USD</em>
              </div>
              <div className="order-row buy">
                <span>buy</span>
                <strong>{toDecimal(1.176 + avgEngagementRate * 0.0003)}</strong>
                <em>X</em>
              </div>
              <p className="spread-copy">
                spread: {toDecimal(0.00009 + avgEngagementRate * 0.00001, 5)} · hi {toDecimal(1.177 + avgScore * 0.0005)}
                · low {toDecimal(1.173 - avgScore * 0.0002)}
              </p>
              <button className="cta-btn" type="button">
                Place order
              </button>
            </article>

            <article className="card depth-card">
              <h3>Depth of market</h3>
              <div className="depth-table">
                {(depthRows.length > 0
                  ? depthRows
                  : [
                      { bidSize: 15, askSize: 18, bid: "1.17640", ask: "1.17661" },
                      { bidSize: 22, askSize: 16, bid: "1.17655", ask: "1.17674" },
                      { bidSize: 31, askSize: 30, bid: "1.17663", ask: "1.17681" },
                    ]
                ).map((row, idx) => (
                  <div className="depth-row" key={`d-${idx}`}>
                    <span>{row.bidSize.toFixed(2)}</span>
                    <strong className="bid">{row.bid}</strong>
                    <strong className="ask">{row.ask}</strong>
                    <span>{row.askSize.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="meta-column">
            <article className="card account-card">
              <h3>Capital</h3>
              <p>FX24</p>
            </article>
            <article className="card mini-stat">
              <span>ROI all time</span>
              <strong>+{(avgScore * 1000 + avgEngagementRate * 110).toFixed(2)}%</strong>
              <p>signal-adjusted</p>
            </article>
            <article className="card mini-stat">
              <span>Investor funds</span>
              <strong>${((totalImpressions / 13 + totalLikes * 5 + 5400) / 1000).toFixed(2)}K</strong>
              <p>synthetic benchmark</p>
            </article>
            <article className="card mini-stat">
              <span>Investors</span>
              <strong>{Math.max(12, activeCount * 8 + tracked.length * 2)}</strong>
              <p>active seats</p>
            </article>
            <button className="copy-btn" type="button">
              Start copying
            </button>
          </div>
        </section>

        <section className="grid-bottom">
          <article className="card market-table-card">
            <div className="chip-row with-action">
              <div>
                <span className="chip active">Watchlists</span>
                <span className="chip">All symbols</span>
              </div>
              <button className="chip add" type="button">
                Create new watchlist +
              </button>
            </div>
            <div className="market-table">
              <div className="row header">
                <span>Popular markets</span>
                <span>Transactions</span>
                <span>Bid</span>
                <span>Ask</span>
              </div>
              {(marketRows.length > 0
                ? marketRows
                : [
                    { symbol: "#NBA", tx: "+12.2", bid: "1.17751", ask: "1.17762" },
                    { symbol: "#NFL", tx: "+4.8", bid: "1.17731", ask: "1.17743" },
                    { symbol: "#COACHINGTIPS", tx: "+18.7", bid: "1.17784", ask: "1.17795" },
                  ]
              ).map((row, idx) => (
                <div className="row" key={`m-${idx}`}>
                  <span>{row.symbol}</span>
                  <span>{row.tx}</span>
                  <span className="green">{row.bid}</span>
                  <span className="orange">{row.ask}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="card top-signals">
            <h3>Top Signals</h3>
            <div className="signal-list">
              {(recent.length > 0
                ? recent
                : [
                    {
                      runId: "n/a",
                      text: "No posted tweets yet.",
                      postedAt: new Date().toISOString(),
                      sport: "n/a",
                      source: "n/a",
                      tweetId: undefined,
                    } as TweetAnalyticsRecord,
                  ]
              ).map((tweet) => (
                <a
                  className="signal-row"
                  key={tweet.runId}
                  href={tweet.tweetId ? `https://x.com/i/web/status/${tweet.tweetId}` : undefined}
                  target={tweet.tweetId ? "_blank" : undefined}
                  rel={tweet.tweetId ? "noopener noreferrer" : undefined}
                >
                  <div>
                    <p>{trimText(tweet.text, 96)}</p>
                    <span>
                      {safeDate(tweet.postedAt)} · {tweet.sport.toUpperCase()} · {tweet.source}
                    </span>
                  </div>
                  <strong>{compact(tweet.metrics?.impressionCount ?? 0)}</strong>
                </a>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
