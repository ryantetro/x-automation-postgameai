import {
  API_SPORTS_KEY,
  TARGET_SPORT,
} from "./config.js";

const API_SPORTS_BASKETBALL_BASE = "https://v1.basketball.api-sports.io";
const API_SPORTS_AMERICAN_FOOTBALL_BASE = "https://v1.american-football.api-sports.io";

const ESPN_SCOREBOARDS: Record<string, string> = {
  nba: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  soccer: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
  mls: "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard",
};

export interface GameRow {
  home: string;
  away: string;
  home_score: number;
  away_score: number;
  status: string;
}

export interface FetchedData {
  sport: string;
  source: string;
  date: string;
  games: GameRow[];
  summary: string;
  top_game: GameRow | Record<string, unknown>;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fetchApiSportsBasketball(): Promise<FetchedData | null> {
  if (!API_SPORTS_KEY) return null;
  const url = `${API_SPORTS_BASKETBALL_BASE}/games?date=${todayIso()}`;
  try {
    const r = await fetch(url, {
      headers: { "x-apisports-key": API_SPORTS_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { response?: unknown[] };
    const response = Array.isArray(data.response) ? data.response : [];
    if (response.length === 0) return null;
    const games: GameRow[] = response.map((g: unknown) => {
      const row = g as Record<string, unknown>;
      const teams = (row.teams as Record<string, { name?: string }>) ?? {};
      const home = (teams.home?.name ?? "TBD") as string;
      const away = (teams.away?.name ?? "TBD") as string;
      const scores = (row.scores as Record<string, number>) ?? {};
      const statusObj = row.status as { short?: string } | undefined;
      const status = (statusObj?.short ?? "?") as string;
      return { home, away, home_score: scores.home ?? 0, away_score: scores.away ?? 0, status };
    });
    return normalize("nba", "api_sports", games);
  } catch {
    return null;
  }
}

async function fetchApiSportsAmericanFootball(): Promise<FetchedData | null> {
  if (!API_SPORTS_KEY) return null;
  const url = `${API_SPORTS_AMERICAN_FOOTBALL_BASE}/games?date=${todayIso()}`;
  try {
    const r = await fetch(url, {
      headers: { "x-apisports-key": API_SPORTS_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { response?: unknown[] };
    const response = Array.isArray(data.response) ? data.response : [];
    if (response.length === 0) return null;
    const games: GameRow[] = response.map((g: unknown) => {
      const row = g as Record<string, unknown>;
      const teams = (row.teams as Record<string, { name?: string }>) ?? {};
      const home = (teams.home?.name ?? "TBD") as string;
      const away = (teams.away?.name ?? "TBD") as string;
      const scores = (row.scores as Record<string, number>) ?? {};
      const statusObj = row.status as { short?: string } | undefined;
      const status = (statusObj?.short ?? "?") as string;
      return { home, away, home_score: scores.home ?? 0, away_score: scores.away ?? 0, status };
    });
    return normalize("nfl", "api_sports", games);
  } catch {
    return null;
  }
}

async function fetchEspn(sport: string): Promise<FetchedData | null> {
  const path = ESPN_SCOREBOARDS[sport];
  if (!path) return null;
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      events?: Array<{
        name?: string;
        shortName?: string;
        competitions?: Array<{
          competitors?: Array<{
            homeAway?: string;
            score?: string;
            team?: { displayName?: string; name?: string };
          }>;
        }>;
        status?: { type?: { completed?: boolean } };
      }>;
    };
    const events = data.events ?? [];
    const games: GameRow[] = events.map((ev) => {
      const comps = ev.competitions ?? [];
      const comp = comps[0];
      const competitors = comp?.competitors ?? [];
      let home = { name: "TBD", score: 0 };
      let away = { name: "TBD", score: 0 };
      for (const c of competitors) {
        const teamName = c.team?.displayName ?? c.team?.name ?? "TBD";
        const score = parseInt(c.score ?? "0", 10) || 0;
        if (c.homeAway === "home") home = { name: teamName, score };
        else away = { name: teamName, score };
      }
      const status = ev.status?.type?.completed ? "Final" : "Live";
      return {
        home: home.name,
        away: away.name,
        home_score: home.score,
        away_score: away.score,
        status,
      };
    });
    return normalize(sport, "espn", games);
  } catch {
    return null;
  }
}

function normalize(sport: string, source: string, games: GameRow[]): FetchedData {
  const top = games[0] ?? ({} as GameRow);
  const summary = top.away
    ? `${top.away} @ ${top.home}: ${top.away_score}-${top.home_score} (${top.status})`
    : `No ${sport.toUpperCase()} games found for today.`;
  return {
    sport,
    source,
    date: todayIso(),
    games,
    summary,
    top_game: top,
  };
}

export async function fetchSportsData(sport?: string): Promise<FetchedData | null> {
  const s = (sport ?? TARGET_SPORT).toLowerCase();
  let payload: FetchedData | null = null;

  if (s === "nba") {
    payload = await fetchApiSportsBasketball();
    if (payload == null) payload = await fetchEspn("nba");
  } else if (s === "nfl") {
    payload = await fetchApiSportsAmericanFootball();
    if (payload == null) payload = await fetchEspn("nfl");
  } else if (s === "mlb") {
    payload = await fetchEspn("mlb");
  } else if (s === "soccer" || s === "mls") {
    payload = await fetchEspn("soccer");
    if (payload) payload = { ...payload, sport: "soccer" };
  } else {
    payload = s in ESPN_SCOREBOARDS ? await fetchEspn(s) : null;
  }

  return payload;
}
