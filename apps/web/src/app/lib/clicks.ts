import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ClickMetricsSnapshot {
  fetchedAt: string;
  totalClicks: number;
  uniqueClicks: number;
}

export interface ClickMetricsLookup {
  available: boolean;
  metrics: Map<string, ClickMetricsSnapshot>;
}

interface LocalClickRecord {
  totalClicks: number;
  uniqueClicks: number;
  updatedAt: string;
  visitors: string[];
}

type LocalClickStore = Record<string, LocalClickRecord>;

const LOCAL_CLICK_STORE_FILE = resolve(process.cwd(), "data", "click-stats.json");
const CLICK_KEY_PREFIX = "xauto:clicks";

function getRestConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.REDIS_REST_URL ??
    "";
  const token =
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.REDIS_REST_TOKEN ??
    "";
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

function totalKey(trackingId: string): string {
  return `${CLICK_KEY_PREFIX}:${trackingId}:total`;
}

function uniqueKey(trackingId: string): string {
  return `${CLICK_KEY_PREFIX}:${trackingId}:unique`;
}

function visitorSetKey(trackingId: string): string {
  return `${CLICK_KEY_PREFIX}:${trackingId}:visitors`;
}

function toCount(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function restCommand<T>(command: string, ...args: string[]): Promise<T | null> {
  const config = getRestConfig();
  if (!config) return null;
  const url = `${config.url}/${[command, ...args].map((part) => encodeURIComponent(part)).join("/")}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { result?: T };
  return payload.result ?? null;
}

async function readLocalStore(): Promise<LocalClickStore> {
  if (!existsSync(LOCAL_CLICK_STORE_FILE)) return {};
  try {
    const raw = await readFile(LOCAL_CLICK_STORE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as LocalClickStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLocalStore(store: LocalClickStore): Promise<void> {
  await mkdir(dirname(LOCAL_CLICK_STORE_FILE), { recursive: true });
  await writeFile(LOCAL_CLICK_STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
}

export function buildVisitorFingerprint(headers: Headers): string | null {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ua = headers.get("user-agent") ?? "";
  const language = headers.get("accept-language") ?? "";
  const basis = [ip, ua, language].filter(Boolean).join("|");
  if (!basis) return null;
  return createHash("sha256").update(basis).digest("hex");
}

export async function getClickMetricsForTrackingIds(trackingIds: string[]): Promise<ClickMetricsLookup> {
  const uniqueTrackingIds = [...new Set(trackingIds.filter(Boolean))];
  const fetchedAt = new Date().toISOString();
  const metrics = new Map<string, ClickMetricsSnapshot>();

  if (uniqueTrackingIds.length === 0) return { available: false, metrics };

  if (getRestConfig()) {
    const [totals, uniques] = await Promise.all([
      restCommand<Array<number | string | null>>("mget", ...uniqueTrackingIds.map(totalKey)),
      restCommand<Array<number | string | null>>("mget", ...uniqueTrackingIds.map(uniqueKey)),
    ]);

    uniqueTrackingIds.forEach((trackingId, index) => {
      metrics.set(trackingId, {
        fetchedAt,
        totalClicks: toCount(totals?.[index]),
        uniqueClicks: toCount(uniques?.[index]),
      });
    });
    return { available: true, metrics };
  }

  if (process.env.NODE_ENV === "production") return { available: false, metrics };

  const store = await readLocalStore();
  uniqueTrackingIds.forEach((trackingId) => {
    const row = store[trackingId];
    metrics.set(trackingId, {
      fetchedAt,
      totalClicks: row?.totalClicks ?? 0,
      uniqueClicks: row?.uniqueClicks ?? 0,
    });
  });
  return { available: true, metrics };
}

export async function recordTrackedClick(
  trackingId: string,
  visitorFingerprint: string | null
): Promise<ClickMetricsSnapshot | null> {
  const fetchedAt = new Date().toISOString();

  if (getRestConfig()) {
    await restCommand("incr", totalKey(trackingId));
    if (visitorFingerprint) {
      const added = toCount(await restCommand<number | string>("sadd", visitorSetKey(trackingId), visitorFingerprint));
      if (added > 0) await restCommand("incr", uniqueKey(trackingId));
    }

    const [totalClicks, uniqueClicks] = await Promise.all([
      restCommand<number | string>("get", totalKey(trackingId)),
      restCommand<number | string>("get", uniqueKey(trackingId)),
    ]);

    return {
      fetchedAt,
      totalClicks: toCount(totalClicks),
      uniqueClicks: toCount(uniqueClicks),
    };
  }

  if (process.env.NODE_ENV === "production") return null;

  const store = await readLocalStore();
  const current = store[trackingId] ?? {
    totalClicks: 0,
    uniqueClicks: 0,
    updatedAt: fetchedAt,
    visitors: [],
  };

  current.totalClicks += 1;
  if (visitorFingerprint && !current.visitors.includes(visitorFingerprint)) {
    current.visitors.push(visitorFingerprint);
    current.uniqueClicks += 1;
  }
  current.updatedAt = fetchedAt;
  store[trackingId] = current;
  await writeLocalStore(store);

  return {
    fetchedAt,
    totalClicks: current.totalClicks,
    uniqueClicks: current.uniqueClicks,
  };
}

export async function getClickMetricsForSlugs(slugs: string[]): Promise<ClickMetricsLookup> {
  return getClickMetricsForTrackingIds(slugs);
}
