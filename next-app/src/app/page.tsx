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

interface WatchItem {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
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

function shortDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { day: "2-digit", month: "short" }).toLowerCase();
}

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(
    value
  );
}

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function synthNumber(seed: number, min: number, max: number): number {
  const span = max - min;
  return min + ((seed % 1000) / 1000) * span;
}

function linePath(values: number[], width: number, height: number): { line: string; area: string } {
  if (values.length === 0) return { line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const points = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = height - ((v - min) / span) * height;
    return { x, y };
  });
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L ${width},${height} L 0,${height} Z`;
  return { line, area };
}

function toTagSymbol(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase() || "X";
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
    // fallback below
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
      // continue
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

  const recent = posted.slice(-8).reverse();
  const tracked = posted.filter((tweet) => !!tweet.metrics);

  const totalImpressions = tracked.reduce((sum, tweet) => sum + (tweet.metrics?.impressionCount ?? 0), 0);
  const totalEngagements = tracked.reduce((sum, tweet) => sum + (tweet.metrics?.engagementCount ?? 0), 0);
  const avgRate = totalImpressions > 0 ? (totalEngagements / totalImpressions) * 100 : 0;

  const tagCount = new Map<string, number>();
  for (const tweet of posted) {
    const tags = tweet.text.match(/#[a-z0-9_]+/gi) ?? [];
    for (const tag of tags) {
      tagCount.set(tag.toUpperCase(), (tagCount.get(tag.toUpperCase()) ?? 0) + 1);
    }
  }

  const watchItems: WatchItem[] = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, count], idx) => {
      const seed = hashSeed(`${tag}-${count}-${idx}`);
      return {
        symbol: toTagSymbol(tag),
        name: tag.replace("#", "").replace(/_/g, " "),
        price: synthNumber(seed, 120, 130000) / (idx === 0 ? 1 : idx === 1 ? 70 : 1000),
        changePct: synthNumber(seed + 77, -3.2, 4.8),
      };
    });

  const fallbackWatch: WatchItem[] = [
    { symbol: "BTC", name: "Bitcoin", price: 109756.89, changePct: 3.42 },
    { symbol: "ETH", name: "Ethereum", price: 1643.32, changePct: 2.17 },
    { symbol: "SOL", name: "Solana", price: 129.79, changePct: 0.17 },
  ];

  const chartSeries = posted.slice(-60).map((tweet, idx) => {
    const base = (tweet.metrics?.impressionCount ?? 1) * 0.6 + (tweet.metrics?.engagementCount ?? 0) * 2.4;
    const seed = hashSeed(`${tweet.runId}-${idx}`);
    return Math.max(1, base + (seed % 14));
  });
  const chartValues =
    chartSeries.length > 12
      ? chartSeries
      : [12, 15, 14, 16, 13, 18, 21, 19, 25, 23, 27, 30, 29, 34, 31, 37, 36, 40, 38, 42, 39, 41, 45];

  const chart = linePath(chartValues, 780, 360);
  const chartOpen = chartValues[0] ?? 0;
  const chartHigh = Math.max(...chartValues);
  const chartLow = Math.min(...chartValues);
  const chartClose = chartValues[chartValues.length - 1] ?? 0;

  const mid = 15305 + avgRate * 4;
  const orderBookAsks = Array.from({ length: 8 }, (_, idx) => {
    const rowSeed = hashSeed(`ask-${idx}-${mid}`);
    const amount = synthNumber(rowSeed, 120, 380);
    const price = mid + (8 - idx) * 0.65 + synthNumber(rowSeed + 10, 0.01, 0.19);
    return { price, amount };
  });

  const orderBookBids = Array.from({ length: 8 }, (_, idx) => {
    const rowSeed = hashSeed(`bid-${idx}-${mid}`);
    const amount = synthNumber(rowSeed, 120, 380);
    const price = mid - idx * 0.61 - synthNumber(rowSeed + 20, 0.01, 0.17);
    return { price, amount };
  });

  const maxAmount = Math.max(...orderBookAsks.map((r) => r.amount), ...orderBookBids.map((r) => r.amount), 1);

  const openOrders = recent.slice(0, 6).map((tweet, idx) => {
    const seed = hashSeed(tweet.runId);
    const side = (tweet.metrics?.engagementCount ?? 0) % 2 === 0 ? "Buy" : "Sell";
    const type = idx % 3 === 0 ? "Limit" : idx % 3 === 1 ? "Stop Limit" : "Market";
    const pair = `${tweet.sport.toUpperCase()}/USDT`;
    const price = (148 + synthNumber(seed, 0.8, 3000)).toFixed(2);
    const amount = synthNumber(seed + 40, 0.01, 9.9).toFixed(2);
    const filled = Math.min(95, Math.round(synthNumber(seed + 70, 0, 100)));
    return {
      id: tweet.runId,
      pair,
      date: safeDate(tweet.postedAt),
      type,
      side,
      price,
      amount,
      filled,
      total: (Number(price) * Number(amount)).toFixed(2),
      tweetId: tweet.tweetId,
    };
  });

  const fallbackOrders = [
    {
      id: "x-1",
      pair: "BTC/USDT",
      date: "Dec 11, 2025 07:00 PM",
      type: "Limit",
      side: "Buy",
      price: "29850.00",
      amount: "0.12",
      filled: 35,
      total: "358.20",
      tweetId: undefined,
    },
  ];

  return (
    <div className="vx-shell">
      <div className="vx-window">
        <header className="vx-browser">
          <div className="vx-dots" aria-hidden="true">
            <span className="red" />
            <span className="yellow" />
            <span className="green" />
          </div>
          <div className="vx-url">vortex.com</div>
          <div className="vx-browser-icons">⌄</div>
        </header>

        <div className="vx-frame">
          <aside className="vx-sidebar">
            <div className="vx-brand">
              <div className="vx-brand-mark">◆</div>
              <div>
                <h1>Vortex</h1>
                <p>Trade at the Speed of Now</p>
              </div>
            </div>

            <nav className="vx-nav">
              <a href="#">Dashboard</a>
              <a href="#">Market</a>
              <a className="active" href="#">
                Trade
              </a>
              <a href="#">Portfolio</a>
              <a href="#">Economic Calendar</a>
            </nav>

            <div className="vx-watchlist">
              <div className="vx-watchlist-head">
                <h2>MY WATCHLIST</h2>
                <span>⋮</span>
              </div>

              {(watchItems.length > 0 ? watchItems : fallbackWatch).map((item) => (
                <div className="vx-watch-item" key={item.symbol}>
                  <div className="vx-coin">{item.symbol.slice(0, 1)}</div>
                  <div>
                    <p className="name">
                      {item.name} ({item.symbol})
                    </p>
                    <p className="price">{usd(item.price)}</p>
                  </div>
                  <div className={`vx-change ${item.changePct >= 0 ? "up" : "down"}`}>
                    {item.changePct >= 0 ? "↗" : "↘"} {item.changePct.toFixed(2)}%
                  </div>
                </div>
              ))}
            </div>

            <div className="vx-premium">
              <strong>Premium Features</strong>
              <p>Trade faster with advanced analytics.</p>
            </div>
          </aside>

          <section className="vx-workspace">
            <header className="vx-topbar">
              <div className="vx-user">
                <div className="avatar">S</div>
                <div>
                  <p className="name">Sholikhul Umam</p>
                  <p className="handle">@sholikhulumam</p>
                </div>
              </div>

              <button type="button" className="vx-deposit">
                Deposit
              </button>

              <div className="vx-search">Search</div>
            </header>

            <div className="vx-panels">
              <div className="vx-center">
                <article className="vx-card vx-chart-card">
                  <header className="vx-chart-head">
                    <div className="pair">
                      <strong>BTC / USDT</strong>
                      <span>Bitstamp</span>
                    </div>
                    <div className="chart-tools">1H · Indicator · Warning</div>
                  </header>

                  <div className="vx-chart-layout">
                    <aside className="vx-tool-rail" aria-hidden="true">
                      <span>＋</span>
                      <span>／</span>
                      <span>≡</span>
                      <span>↔</span>
                      <span>○</span>
                      <span>T</span>
                      <span>⌖</span>
                      <span>⌕</span>
                      <span>⌂</span>
                    </aside>

                    <div className="vx-chart-canvas">
                      <div className="vx-chart-meta">
                        <span>Volume {compact(totalImpressions)}</span>
                        <span>O {chartOpen.toFixed(2)}</span>
                        <span>H {chartHigh.toFixed(2)}</span>
                        <span>L {chartLow.toFixed(2)}</span>
                        <span>C {chartClose.toFixed(2)}</span>
                      </div>

                      <svg viewBox="0 0 780 390" preserveAspectRatio="none" aria-hidden="true">
                        <defs>
                          <pattern id="vxGrid" width="52" height="32" patternUnits="userSpaceOnUse">
                            <path d="M 52 0 L 0 0 0 32" fill="none" stroke="rgba(126,145,187,0.14)" strokeWidth="1" />
                          </pattern>
                          <linearGradient id="vxArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(113,255,166,0.22)" />
                            <stop offset="100%" stopColor="rgba(113,255,166,0)" />
                          </linearGradient>
                        </defs>
                        <rect x="0" y="0" width="780" height="360" fill="url(#vxGrid)" />
                        <path d={chart.area} fill="url(#vxArea)" />
                        <path d={chart.line} fill="none" stroke="#f1f4ff" strokeWidth="2" strokeLinecap="round" />
                      </svg>

                      <div className="vx-axis-x">
                        {(posted.length > 0 ? posted.slice(-6).map((tweet) => shortDay(tweet.postedAt)) : ["22 jul", "23 jul", "24 jul", "25 jul"]).map(
                          (label, idx) => (
                            <span key={`${label}-${idx}`}>{label}</span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                </article>

                <article className="vx-card vx-orders-card">
                  <header>
                    <h3>Open Orders</h3>
                    <button type="button">Cancel All</button>
                  </header>

                  <div className="vx-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Pair</th>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Side</th>
                          <th>Price</th>
                          <th>Amount</th>
                          <th>Filled</th>
                          <th>Total</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(openOrders.length > 0 ? openOrders : fallbackOrders).map((row) => (
                          <tr key={row.id}>
                            <td>{row.pair}</td>
                            <td>{row.date}</td>
                            <td>{row.type}</td>
                            <td className={row.side === "Buy" ? "buy" : "sell"}>{row.side}</td>
                            <td>{row.price}</td>
                            <td>{row.amount}</td>
                            <td>{row.filled}%</td>
                            <td>{row.total}</td>
                            <td>
                              {row.tweetId ? (
                                <a href={`https://x.com/i/web/status/${row.tweetId}`} target="_blank" rel="noopener noreferrer">
                                  View
                                </a>
                              ) : (
                                <button type="button">Cancel</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              </div>

              <aside className="vx-right">
                <article className="vx-card vx-orderbook-card">
                  <header>
                    <h3>Order Book</h3>
                  </header>

                  <div className="vx-ob-head">
                    <span>Price</span>
                    <span>Amount</span>
                  </div>

                  <div className="vx-ob-body">
                    {orderBookAsks.map((row, idx) => (
                      <div className="ob-row ask" key={`ask-${idx}`}>
                        <span>{row.price.toFixed(2)}</span>
                        <div className="bar" style={{ width: `${(row.amount / maxAmount) * 100}%` }} />
                        <em>{row.amount.toFixed(0)}</em>
                      </div>
                    ))}

                    <div className="ob-mid">{mid.toFixed(2)}</div>

                    {orderBookBids.map((row, idx) => (
                      <div className="ob-row bid" key={`bid-${idx}`}>
                        <span>{row.price.toFixed(2)}</span>
                        <div className="bar" style={{ width: `${(row.amount / maxAmount) * 100}%` }} />
                        <em>{row.amount.toFixed(0)}</em>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="vx-card vx-buy-card">
                  <header>
                    <h3>Buy</h3>
                  </header>

                  <div className="vx-buy-tabs">
                    <span className="active">Limit</span>
                    <span>Market</span>
                  </div>

                  <label>
                    Price
                    <input value={mid.toFixed(2)} readOnly />
                  </label>

                  <label>
                    Amount
                    <input value={(Math.max(0.12, avgRate / 8) + 0.2).toFixed(2)} readOnly />
                  </label>

                  <div className="vx-buy-scale">
                    <span>0%</span>
                    <span>25%</span>
                    <span>50%</span>
                    <span>75%</span>
                    <span>100%</span>
                  </div>

                  <label>
                    Total
                    <input value={usd(mid * (Math.max(0.12, avgRate / 8) + 0.2))} readOnly />
                  </label>

                  <button type="button" className="buy-btn">
                    Place Buy
                  </button>
                </article>
              </aside>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
