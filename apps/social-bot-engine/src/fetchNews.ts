import {
  NEWS_ALLOWED_DOMAINS,
  NEWS_ALLOWED_SOURCES,
  NEWS_API_KEY,
  NEWS_ENABLED,
  NEWS_LANGUAGE,
  NEWS_LOOKBACK_HOURS,
  NEWS_MAX_ARTICLES,
  NEWS_SORT_BY,
} from "./config.js";

const NEWS_API_URL = "https://newsapi.org/v2/everything";
const NEWS_TIMEOUT_MS = 15000;
const NEWS_SELECTION_THRESHOLD = 3;

const SPORT_NEWS_QUERIES: Record<string, string> = {
  nba: "NBA AND (injury OR lineup OR defense OR offense OR efficiency OR coach OR playoff OR streak OR breakout)",
  nfl: "NFL AND (injury OR offense OR defense OR coach OR lineup OR scheme OR efficiency OR free agency)",
  mlb: "MLB AND (lineup OR bullpen OR defense OR analytics OR injury OR breakout OR manager)",
  soccer: "(MLS OR soccer) AND (injury OR tactics OR coach OR lineup OR pressing OR match OR form)",
};

const RELEVANCE_TERMS: Record<string, string[]> = {
  nba: ["nba", "coach", "coaching", "defense", "offense", "efficiency", "playoff", "injury", "lineup", "breakout", "streak"],
  nfl: ["nfl", "coach", "coaching", "offense", "defense", "efficiency", "injury", "lineup", "scheme", "free agency"],
  mlb: ["mlb", "manager", "lineup", "bullpen", "defense", "analytics", "injury", "breakout", "rotation"],
  soccer: ["soccer", "mls", "coach", "coaching", "tactics", "match", "injury", "lineup", "pressing", "form"],
};

const NEGATIVE_TERMS = [
  "betting",
  "odds",
  "fantasy",
  "draftkings",
  "fanduel",
  "rumor",
  "rumours",
  "trade machine",
  "buy now",
  "sale",
  "deals",
  "everything you need to know",
  "live updates",
  "live blog",
  "watch",
  "tickets",
  "stocks",
  "etf",
  "crypto",
];

const SENSATIONAL_TERMS = ["shocking", "insane", "stunning", "wild", "unbelievable", "massive"];
const COACHING_TERMS = [
  "coach",
  "coaching",
  "manager",
  "development",
  "tactics",
  "scheme",
  "lineup",
  "bullpen",
  "rotation",
  "offense",
  "defense",
  "efficiency",
  "pressing",
  "match",
  "form",
  "breakout",
  "injury",
];
const HARD_REJECTION_TERMS = [
  "fantasy football",
  "fantasy basketball",
  "fantasy baseball",
  "sportsbook",
  "betting odds",
  "trade rumor",
  "rumour",
  "mock draft",
  "ticket deal",
  "merch sale",
  "crypto",
  "stock market",
  "etf",
];

export interface NewsArticle {
  sourceId?: string;
  sourceName: string;
  author?: string;
  title: string;
  description?: string;
  url: string;
  publishedAt: string;
  content?: string;
}

export interface NewsSearchResult {
  query: string;
  source: "newsapi";
  articles: NewsArticle[];
}

export interface NewsContext extends NewsSearchResult {
  selectedArticle?: NewsArticle;
  selectionReason?: string;
  usedNews: boolean;
}

interface RankedArticle {
  article: NewsArticle;
  score: number;
  reasons: string[];
}

interface NewsApiArticle {
  source?: { id?: string | null; name?: string | null };
  author?: string | null;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  publishedAt?: string | null;
  content?: string | null;
}

function getNewsQueryForSport(sport: string): string {
  return SPORT_NEWS_QUERIES[sport.toLowerCase()] ?? `${sport.toUpperCase()} AND (coach OR coaching OR player development)`;
}

function getIsoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function containsTerm(text: string, terms: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function keywordHits(text: string, terms: readonly string[]): number {
  const haystack = text.toLowerCase();
  return terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
}

function freshnessScore(publishedAt: string): number {
  const ageMs = Date.now() - Date.parse(publishedAt);
  if (!Number.isFinite(ageMs)) return -10;
  const ageHours = ageMs / (60 * 60 * 1000);
  if (ageHours <= 12) return 3;
  if (ageHours <= 24) return 2;
  if (ageHours <= 36) return 1;
  return -3;
}

function articleText(article: NewsArticle): string {
  return [article.title, article.description ?? "", article.content ?? ""].join(" ").toLowerCase();
}

function hasHardRejection(text: string): boolean {
  return containsTerm(text, HARD_REJECTION_TERMS);
}

function isAllowedArticle(article: NewsArticle): boolean {
  const domain = hostnameOf(article.url);
  const domainAllowed =
    NEWS_ALLOWED_DOMAINS.length === 0 ||
    NEWS_ALLOWED_DOMAINS.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
  const sourceAllowed =
    NEWS_ALLOWED_SOURCES.length === 0 ||
    NEWS_ALLOWED_SOURCES.includes((article.sourceId ?? "").toLowerCase());
  return domainAllowed && sourceAllowed;
}

function scoreArticle(article: NewsArticle, sport: string): RankedArticle {
  const text = articleText(article);
  const reasons: string[] = [];

  if (!isAllowedArticle(article)) {
    return { article, score: Number.NEGATIVE_INFINITY, reasons: ["rejected:not-allowlisted"] };
  }

  if (hasHardRejection(text)) {
    return { article, score: Number.NEGATIVE_INFINITY, reasons: ["rejected:hard-negative-term"] };
  }

  const positiveTerms = RELEVANCE_TERMS[sport.toLowerCase()] ?? ["coach", "coaching", "development"];
  let score = 0;

  const freshness = freshnessScore(article.publishedAt);
  score += freshness;
  reasons.push(`freshness:${freshness}`);

  const positiveHits = keywordHits(text, positiveTerms);
  score += positiveHits;
  reasons.push(`sport-terms:${positiveHits}`);

  const coachingHits = keywordHits(text, COACHING_TERMS);
  if (coachingHits > 0) {
    score += 2;
    reasons.push(`coaching-bonus:${Math.min(coachingHits, 3)}`);
  }

  const domain = hostnameOf(article.url);
  if (["nba.com", "nfl.com", "mlb.com", "espn.com"].some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`))) {
    score += 1;
    reasons.push("domain-bonus:official");
  }

  if (containsTerm(text, NEGATIVE_TERMS)) {
    score -= 5;
    reasons.push("penalty:negative-term");
  }

  if (containsTerm(text, SENSATIONAL_TERMS)) {
    score -= 2;
    reasons.push("penalty:sensational");
  }

  if (positiveHits === 0 && coachingHits === 0) {
    score -= 3;
    reasons.push("penalty:weak-relevance");
  }

  return { article, score, reasons };
}

function normalizeArticles(rows: NewsApiArticle[]): NewsArticle[] {
  return rows
    .map((row) => ({
      sourceId: row.source?.id ?? undefined,
      sourceName: row.source?.name?.trim() || "Unknown source",
      author: row.author ?? undefined,
      title: row.title?.trim() ?? "",
      description: row.description?.trim() ?? undefined,
      url: row.url?.trim() ?? "",
      publishedAt: row.publishedAt?.trim() ?? "",
      content: row.content?.trim() ?? undefined,
    }))
    .filter((row) => row.title.length > 0 && row.url.length > 0 && row.publishedAt.length > 0);
}

export async function fetchNewsContext(sport: string): Promise<NewsContext> {
  const query = getNewsQueryForSport(sport);
  const fallback: NewsContext = {
    query,
    source: "newsapi",
    articles: [],
    usedNews: false,
  };

  if (!NEWS_ENABLED || !NEWS_API_KEY) {
    return {
      ...fallback,
      selectionReason: NEWS_ENABLED ? "NewsAPI key missing" : "News disabled",
    };
  }

  const url = new URL(NEWS_API_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("searchIn", "title,description");
  url.searchParams.set("from", getIsoHoursAgo(NEWS_LOOKBACK_HOURS));
  url.searchParams.set("language", NEWS_LANGUAGE);
  url.searchParams.set("sortBy", NEWS_SORT_BY);
  url.searchParams.set("pageSize", String(NEWS_MAX_ARTICLES));
  if (NEWS_ALLOWED_DOMAINS.length > 0) {
    url.searchParams.set("domains", NEWS_ALLOWED_DOMAINS.join(","));
  } else if (NEWS_ALLOWED_SOURCES.length > 0) {
    url.searchParams.set("sources", NEWS_ALLOWED_SOURCES.join(","));
  }

  try {
    const response = await fetch(url, {
      headers: {
        "X-Api-Key": NEWS_API_KEY,
      },
      signal: AbortSignal.timeout(NEWS_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { ...fallback, selectionReason: `NewsAPI request failed (${response.status})` };
    }

    const payload = (await response.json()) as { status?: string; articles?: NewsApiArticle[]; message?: string };
    if (payload.status !== "ok" || !Array.isArray(payload.articles)) {
      return { ...fallback, selectionReason: payload.message ?? "NewsAPI returned no articles" };
    }

    const articles = normalizeArticles(payload.articles);
    const ranked = [...articles]
      .map((article) => scoreArticle(article, sport))
      .filter((row) => Number.isFinite(row.score))
      .sort((a, b) => b.score - a.score);

    if (ranked.length > 0) {
      console.info(
        `News candidates for ${sport}: ` +
          ranked
            .slice(0, 5)
            .map((row) => {
              const domain = hostnameOf(row.article.url) || "unknown";
              return `"${row.article.title}" [${row.article.sourceName}/${domain}] score=${row.score} (${row.reasons.join(", ")})`;
            })
            .join(" | ")
      );
    }

    const selected = ranked[0];
    if (!selected || selected.score < NEWS_SELECTION_THRESHOLD) {
      return {
        ...fallback,
        articles,
        selectionReason:
          ranked.length > 0
            ? `No article cleared confidence threshold (top score ${selected.score})`
            : "No allowlisted relevant articles found",
      };
    }

    return {
      query,
      source: "newsapi",
      articles,
      selectedArticle: selected.article,
      selectionReason: `Selected article scored ${selected.score} (${selected.reasons.join(", ")})`,
      usedNews: true,
    };
  } catch (error) {
    return {
      ...fallback,
      selectionReason: `NewsAPI error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
