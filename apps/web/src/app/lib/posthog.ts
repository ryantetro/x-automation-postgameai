export interface TrafficMetricsSnapshot {
  fetchedAt: string;
  landingVisits: number;
  uniqueVisitors: number;
  sessions: number;
  engagedSessions: number;
  signupsStarted: number;
  signupsCompleted: number;
  demoBookings: number;
  trialStarts: number;
  purchases: number;
}

export interface TrafficMetricsLookup {
  available: boolean;
  metrics: Map<string, TrafficMetricsSnapshot>;
}

type QueryRow = {
  tracking_id: string;
  landing_visits: number;
  unique_visitors: number;
  sessions: number;
  engaged_sessions: number;
  signups_started: number;
  signups_completed: number;
  demo_bookings: number;
  trial_starts: number;
  purchases: number;
};

function getPostHogConfig(): { host: string; apiKey: string; projectId: string } | null {
  const host = (process.env.POSTHOG_HOST || "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.POSTHOG_PROJECT_API_KEY || "").trim();
  const projectId = (process.env.POSTHOG_PROJECT_ID || "").trim();
  if (!host || !apiKey || !projectId) return null;
  return { host, apiKey, projectId };
}

function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string"
      ? Number.parseInt(value, 10) || 0
      : 0;
}

function parseRows(payload: unknown): QueryRow[] {
  if (!payload || typeof payload !== "object") return [];
  const withResults = payload as { results?: unknown; columns?: unknown };
  if (Array.isArray(withResults.results)) {
    if (withResults.results.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      return withResults.results as QueryRow[];
    }
    if (Array.isArray(withResults.columns)) {
      const columns = withResults.columns.filter((value): value is string => typeof value === "string");
      return withResults.results
        .filter(Array.isArray)
        .map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])) as QueryRow);
    }
  }
  return [];
}

async function queryTrackingBatch(config: { host: string; apiKey: string; projectId: string }, trackingIds: string[]): Promise<QueryRow[]> {
  if (trackingIds.length === 0) return [];
  const idList = trackingIds.map((trackingId) => `'${escapeSqlString(trackingId)}'`).join(", ");
  const query = `
    SELECT
      JSONExtractString(properties, 'tracking_id') AS tracking_id,
      countIf(event = 'post_landing') AS landing_visits,
      uniqIf(distinct_id, event = 'post_landing') AS unique_visitors,
      uniqIf(JSONExtractString(properties, '$session_id'), JSONExtractString(properties, '$session_id') != '') AS sessions,
      uniqIf(JSONExtractString(properties, '$session_id'), event = 'page_view_attributed' AND JSONExtractString(properties, '$session_id') != '') AS engaged_sessions,
      countIf(event = 'signup_started') AS signups_started,
      countIf(event = 'signup_completed') AS signups_completed,
      countIf(event = 'demo_booked') AS demo_bookings,
      countIf(event = 'trial_started') AS trial_starts,
      countIf(event = 'purchase_completed') AS purchases
    FROM events
    WHERE JSONExtractString(properties, 'tracking_id') IN (${idList})
    GROUP BY tracking_id
  `;

  const response = await fetch(`${config.host}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: {
        kind: "HogQLQuery",
        query,
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`PostHog query failed (${response.status})`);
  }

  return parseRows(await response.json());
}

export async function getTrafficMetricsForTrackingIds(trackingIds: string[]): Promise<TrafficMetricsLookup> {
  const config = getPostHogConfig();
  const metrics = new Map<string, TrafficMetricsSnapshot>();
  const uniqueIds = [...new Set(trackingIds.filter(Boolean))];
  if (!config || uniqueIds.length === 0) return { available: false, metrics };

  try {
    const fetchedAt = new Date().toISOString();
    const rows: QueryRow[] = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
      const batch = uniqueIds.slice(index, index + 100);
      rows.push(...await queryTrackingBatch(config, batch));
    }

    rows.forEach((row) => {
      metrics.set(row.tracking_id, {
        fetchedAt,
        landingVisits: toNumber(row.landing_visits),
        uniqueVisitors: toNumber(row.unique_visitors),
        sessions: toNumber(row.sessions),
        engagedSessions: toNumber(row.engaged_sessions),
        signupsStarted: toNumber(row.signups_started),
        signupsCompleted: toNumber(row.signups_completed),
        demoBookings: toNumber(row.demo_bookings),
        trialStarts: toNumber(row.trial_starts),
        purchases: toNumber(row.purchases),
      });
    });

    uniqueIds.forEach((trackingId) => {
      if (!metrics.has(trackingId)) {
        metrics.set(trackingId, {
          fetchedAt,
          landingVisits: 0,
          uniqueVisitors: 0,
          sessions: 0,
          engagedSessions: 0,
          signupsStarted: 0,
          signupsCompleted: 0,
          demoBookings: 0,
          trialStarts: 0,
          purchases: 0,
        });
      }
    });

    return { available: true, metrics };
  } catch (error) {
    console.warn("PostHog traffic lookup failed:", error);
    return { available: false, metrics };
  }
}
