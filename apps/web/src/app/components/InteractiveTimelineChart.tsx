"use client";

import { useId, useRef, useState } from "react";
import { buildSmoothAreaPath, buildSmoothLinePath } from "../lib/chartPaths";

type ChartMetric = "impressions" | "engagements" | "likes" | "retweets";
type ChartRange = "10_posts" | "72h" | "7d" | "30d" | "all";
type ChartView = "per_post" | "daily";
type PlatformKey = "x" | "threads";

interface TimelineRecord {
  runId: string;
  postedAt: string;
  sport: string;
  angle: string;
  tweetId?: string;
  threadsPostId?: string;
  platform: PlatformKey;
  campaignSlug?: string;
  campaignName?: string;
  metrics?: {
    impressionCount: number | null;
    engagementCount: number;
    likeCount: number;
    retweetCount: number;
  };
}

interface DisplayPoint {
  key: string;
  postedAt: string;
  label: string;
  sport: string;
  platform: PlatformKey;
  seriesKey: string;
  campaignSlug?: string;
  campaignName?: string;
  posts: number;
  metricValue: number;
  impressions: number;
  engagements: number;
  likes: number;
  retweets: number;
  tweetId?: string;
  threadsPostId?: string;
}

interface InteractiveTimelineChartProps {
  records: TimelineRecord[];
}

type GeometryPoint = DisplayPoint & { x: number; y: number; index: number };
type AxisTick = {
  key: string;
  x: number;
  align: "start" | "center" | "end";
  primary: string;
  secondary?: string;
};

type SeriesMeta = {
  seriesKey: string;
  platform: PlatformKey;
  label: string;
  color: string;
  gradientStart: string;
  gradientEnd: string;
};

type SeriesGeometry = SeriesMeta & {
  points: GeometryPoint[];
  line: string;
  area: string;
};

const RANGE_OPTIONS: Array<{ value: ChartRange; label: string }> = [
  { value: "10_posts", label: "Last 10" },
  { value: "72h", label: "72h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

const VIEW_OPTIONS: Array<{ value: ChartView; label: string }> = [
  { value: "per_post", label: "Per post" },
  { value: "daily", label: "Daily rollup" },
];

const METRIC_OPTIONS: Array<{ value: ChartMetric; label: string; tone: string }> = [
  { value: "impressions", label: "Impressions", tone: "green" },
  { value: "engagements", label: "Engagements", tone: "blue" },
  { value: "likes", label: "Likes", tone: "red" },
  { value: "retweets", label: "Retweets", tone: "amber" },
];

const CHART_WIDTH = 960;
const CHART_HEIGHT = 360;
const CHART_PADDING = { top: 20, right: 20, bottom: 38, left: 56 };

const SERIES_COLORS: Array<{ color: string; gradientStart: string; gradientEnd: string }> = [
  { color: "#19c37d", gradientStart: "rgba(25, 195, 125, 0.25)", gradientEnd: "rgba(25, 195, 125, 0.02)" },
  { color: "#06b6d4", gradientStart: "rgba(6, 182, 212, 0.25)", gradientEnd: "rgba(6, 182, 212, 0.02)" },
  { color: "#f59e0b", gradientStart: "rgba(245, 158, 11, 0.25)", gradientEnd: "rgba(245, 158, 11, 0.02)" },
  { color: "#f43f5e", gradientStart: "rgba(244, 63, 94, 0.25)", gradientEnd: "rgba(244, 63, 94, 0.02)" },
  { color: "#a78bfa", gradientStart: "rgba(168, 139, 250, 0.25)", gradientEnd: "rgba(168, 139, 250, 0.02)" },
  { color: "#ef4444", gradientStart: "rgba(239, 68, 68, 0.25)", gradientEnd: "rgba(239, 68, 68, 0.02)" },
  { color: "#ec4899", gradientStart: "rgba(236, 72, 153, 0.25)", gradientEnd: "rgba(236, 72, 153, 0.02)" },
  { color: "#84cc16", gradientStart: "rgba(132, 204, 22, 0.25)", gradientEnd: "rgba(132, 204, 22, 0.02)" },
];

function deriveSeriesKey(record: { platform: PlatformKey; campaignSlug?: string }): string {
  return record.campaignSlug ? `${record.campaignSlug}:${record.platform}` : record.platform;
}

function buildSeriesMeta(records: TimelineRecord[]): SeriesMeta[] {
  const seen = new Map<string, { platform: PlatformKey; campaignSlug?: string; campaignName?: string }>();
  for (const record of records) {
    const key = deriveSeriesKey(record);
    if (!seen.has(key)) {
      seen.set(key, { platform: record.platform, campaignSlug: record.campaignSlug, campaignName: record.campaignName });
    }
  }

  const hasCampaigns = [...seen.values()].some((s) => s.campaignSlug);
  const entries = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([seriesKey, info], idx) => {
    const colors = SERIES_COLORS[idx % SERIES_COLORS.length];
    const platformLabel = info.platform === "x" ? "X" : "Threads";
    const label = hasCampaigns && info.campaignName
      ? `${info.campaignName} · ${platformLabel}`
      : platformLabel;

    return { seriesKey, platform: info.platform, label, ...colors };
  });
}

function formatRangeLabel(range: ChartRange, count: number): string {
  if (range === "10_posts") return `Last ${count} posts`;
  if (range === "72h") return "Last 72 hours";
  if (range === "7d") return "Last 7 days";
  if (range === "30d") return "Last 30 days";
  return "All tracked posts";
}

function formatMetricValue(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatAxisTime(date: Date): string {
  const hasMinutes = date.getMinutes() !== 0;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: hasMinutes ? "2-digit" : undefined,
  });
}

function formatAxisTickLabel(iso: string, view: ChartView): { primary: string; secondary?: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { primary: "--" };
  if (view === "daily") {
    return {
      primary: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      secondary: date.toLocaleDateString("en-US", { weekday: "short" }),
    };
  }
  return {
    primary: `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${formatAxisTime(date)}`,
    secondary: date.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

function formatDetailLabel(iso: string, view: ChartView): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  if (view === "daily") return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return date.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function metricValueFor(record: TimelineRecord, metric: ChartMetric): number {
  if (metric === "impressions") return record.metrics?.impressionCount ?? 0;
  if (metric === "engagements") return record.metrics?.engagementCount ?? 0;
  if (metric === "likes") return record.metrics?.likeCount ?? 0;
  return record.metrics?.retweetCount ?? 0;
}

function localDayKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localMiddayIso(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0).toISOString();
}

function buildDisplayPoints(records: TimelineRecord[], metric: ChartMetric, view: ChartView): DisplayPoint[] {
  if (view === "per_post") {
    return records.map((record) => ({
      key: record.runId,
      postedAt: record.postedAt,
      label: formatDetailLabel(record.postedAt, view),
      sport: record.sport,
      platform: record.platform,
      seriesKey: deriveSeriesKey(record),
      campaignSlug: record.campaignSlug,
      campaignName: record.campaignName,
      posts: 1,
      metricValue: metricValueFor(record, metric),
      impressions: record.metrics?.impressionCount ?? 0,
      engagements: record.metrics?.engagementCount ?? 0,
      likes: record.metrics?.likeCount ?? 0,
      retweets: record.metrics?.retweetCount ?? 0,
      tweetId: record.tweetId,
      threadsPostId: record.threadsPostId,
    }));
  }

  const grouped = new Map<string, DisplayPoint>();
  for (const record of records) {
    const sKey = deriveSeriesKey(record);
    const key = `${sKey}:${localDayKey(record.postedAt)}`;
    const current = grouped.get(key);
    const impressions = record.metrics?.impressionCount ?? 0;
    const engagements = record.metrics?.engagementCount ?? 0;
    const likes = record.metrics?.likeCount ?? 0;
    const retweets = record.metrics?.retweetCount ?? 0;

    if (!current) {
      grouped.set(key, {
        key,
        postedAt: localMiddayIso(record.postedAt),
        label: formatDetailLabel(record.postedAt, view),
        sport: record.sport,
        platform: record.platform,
        seriesKey: sKey,
        campaignSlug: record.campaignSlug,
        campaignName: record.campaignName,
        posts: 1,
        metricValue: metricValueFor(record, metric),
        impressions,
        engagements,
        likes,
        retweets,
        tweetId: record.tweetId,
        threadsPostId: record.threadsPostId,
      });
      continue;
    }

    current.posts += 1;
    current.metricValue += metricValueFor(record, metric);
    current.impressions += impressions;
    current.engagements += engagements;
    current.likes += likes;
    current.retweets += retweets;
    if (Date.parse(record.postedAt) > Date.parse(current.postedAt)) current.sport = record.sport;
    current.tweetId = record.tweetId ?? current.tweetId;
    current.threadsPostId = record.threadsPostId ?? current.threadsPostId;
  }

  return [...grouped.values()].sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
}

function buildAxisTicks(points: GeometryPoint[], view: ChartView): AxisTick[] {
  if (points.length === 0) return [];

  const maxTicks = Math.min(points.length, view === "daily" ? 5 : 4);
  const minGap = view === "daily" ? 110 : 154;
  const lastIndex = points.length - 1;
  const idealIndexes = new Set<number>();

  for (let index = 0; index < maxTicks; index += 1) {
    idealIndexes.add(Math.round((index * lastIndex) / Math.max(maxTicks - 1, 1)));
  }

  const sortedIndexes = [...idealIndexes].sort((a, b) => a - b);
  const selected: number[] = [];

  for (const index of sortedIndexes) {
    if (selected.length === 0) {
      selected.push(index);
      continue;
    }

    const previousIndex = selected[selected.length - 1];
    const isLastTick = index === lastIndex;
    if (points[index].x - points[previousIndex].x < minGap) {
      if (isLastTick) selected[selected.length - 1] = index;
      continue;
    }

    selected.push(index);
  }

  if (selected[selected.length - 1] !== lastIndex) {
    if (points[lastIndex].x - points[selected[selected.length - 1]].x < minGap && selected.length > 1) {
      selected[selected.length - 1] = lastIndex;
    } else {
      selected.push(lastIndex);
    }
  }

  return selected.map((index, tickIndex) => {
    const point = points[index];
    const label = formatAxisTickLabel(point.postedAt, view);
    const align = tickIndex === 0 ? "start" : tickIndex === selected.length - 1 ? "end" : "center";

    return {
      key: point.key,
      x: point.x,
      align,
      primary: label.primary,
      secondary: label.secondary,
    };
  });
}

export default function InteractiveTimelineChart({ records }: InteractiveTimelineChartProps) {
  const baseId = useId();
  const gridId = useId();
  const [metric, setMetric] = useState<ChartMetric>("impressions");
  const [range, setRange] = useState<ChartRange>("10_posts");
  const [view, setView] = useState<ChartView>("per_post");
  const [sport, setSport] = useState<string>("all");
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [animationSeed, setAnimationSeed] = useState(0);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; flipLeft: boolean } | null>(null);
  const [focusSeriesKey, setFocusSeriesKey] = useState<string | null>(null);

  function toggleSeries(id: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    refreshChart();
  }

  function refreshChart() {
    setAnimationSeed((value) => value + 1);
    setActiveKey(null);
    setTooltipPos(null);
  }

  function handleMetricChange(nextMetric: ChartMetric) {
    setMetric(nextMetric);
    refreshChart();
  }

  function handleRangeChange(nextRange: ChartRange) {
    setRange(nextRange);
    refreshChart();
  }

  function handleViewChange(nextView: ChartView) {
    setView(nextView);
    refreshChart();
  }

  function handleSportChange(nextSport: string) {
    setSport(nextSport);
    refreshChart();
  }

  const tracked = records.filter((record) => record.metrics);
  const sports = [...new Set(tracked.map((record) => record.sport.toLowerCase()))].sort();
  const sorted = [...tracked].sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  const filteredBySport = sport === "all" ? sorted : sorted.filter((record) => record.sport.toLowerCase() === sport);
  const latestTimestamp = filteredBySport.length > 0 ? Date.parse(filteredBySport[filteredBySport.length - 1].postedAt) : 0;

  let filtered = filteredBySport;
  if (range === "10_posts") filtered = filteredBySport.slice(-10);
  if (range === "72h") filtered = filteredBySport.filter((record) => Date.parse(record.postedAt) >= latestTimestamp - 72 * 60 * 60 * 1000);
  if (range === "7d") filtered = filteredBySport.filter((record) => Date.parse(record.postedAt) >= latestTimestamp - 7 * 24 * 60 * 60 * 1000);
  if (range === "30d") filtered = filteredBySport.filter((record) => Date.parse(record.postedAt) >= latestTimestamp - 30 * 24 * 60 * 60 * 1000);

  const allSeriesMeta = buildSeriesMeta(filtered);
  const seriesLookup = new Map<string, SeriesMeta>(allSeriesMeta.map((m) => [m.seriesKey, m]));

  const allDisplayPoints = buildDisplayPoints(filtered, metric, view);
  const displayPoints = allDisplayPoints.filter((point) => !hiddenSeries.has(point.seriesKey));
  const activePoint = displayPoints.find((point) => point.key === activeKey) ?? displayPoints[displayPoints.length - 1] ?? null;

  const innerWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const innerHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const timestamps = displayPoints.map((point) => Date.parse(point.postedAt));
  const minTime = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const maxTime = timestamps.length > 0 ? Math.max(...timestamps) : 1;
  const maxValue = Math.max(...displayPoints.map((point) => point.metricValue), 1);
  const geometry = displayPoints.map((point, index) => {
    const timestamp = Date.parse(point.postedAt);
    const normalizedX =
      displayPoints.length === 1 || maxTime === minTime ? 0.5 : (timestamp - minTime) / Math.max(maxTime - minTime, 1);
    const x = CHART_PADDING.left + normalizedX * innerWidth;
    const y = CHART_PADDING.top + innerHeight - (point.metricValue / maxValue) * innerHeight;
    return { ...point, index, x, y };
  });

  const seriesGeometry: SeriesGeometry[] = allSeriesMeta
    .filter((meta) => !hiddenSeries.has(meta.seriesKey))

    .map((meta) => {
      const points = geometry.filter((point) => point.seriesKey === meta.seriesKey);
      if (points.length === 0) return null;
      return {
        ...meta,
        points,
        line: buildSmoothLinePath(points),
        area: buildSmoothAreaPath(points, CHART_PADDING.top + innerHeight),
      };
    })
    .filter((entry): entry is SeriesGeometry => entry !== null);

  function handleChartMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!chartWrapRef.current || geometry.length === 0) return;
    const rect = chartWrapRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const pctX = mouseX / rect.width;

    const style = getComputedStyle(chartWrapRef.current);
    const padLeft = parseFloat(style.paddingLeft) || 12;
    const padRight = parseFloat(style.paddingRight) || 12;
    const svgWidth = rect.width - padLeft - padRight;
    const svgX = ((mouseX - padLeft) / svgWidth) * CHART_WIDTH;

    const selectableGeometry = focusSeriesKey ? geometry.filter(pt => pt.seriesKey === focusSeriesKey) : geometry;
    if (selectableGeometry.length === 0) {
      setActiveKey(null);
      setTooltipPos(null);
      return;
    }

    let nearest = selectableGeometry[0];
    let nearestDist = Infinity;
    for (const pt of selectableGeometry) {
      const dist = Math.abs(pt.x - svgX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = pt;
      }
    }

    setActiveKey(nearest.key);
    setTooltipPos({ x: mouseX, y: mouseY, flipLeft: pctX > 0.62 });
  }

  function handleChartMouseLeave() {
    setActiveKey(null);
    setTooltipPos(null);
  }

  function handleChartClick() {
    if (focusSeriesKey) {
      setFocusSeriesKey(null);
    } else if (activePoint) {
      setFocusSeriesKey(activePoint.seriesKey);
    }
  }

  const activeGeometry = geometry.find((point) => point.key === activePoint?.key) ?? null;
  const activeSeriesMeta = activePoint ? seriesLookup.get(activePoint.seriesKey) : null;
  const ticks = buildAxisTicks(geometry, view);
  const filteredTotals = filtered
    .filter((record) => !hiddenSeries.has(deriveSeriesKey(record)))
    .reduce(
      (acc, record) => {
        acc.impressions += record.metrics?.impressionCount ?? 0;
        acc.engagements += record.metrics?.engagementCount ?? 0;
        acc.likes += record.metrics?.likeCount ?? 0;
        acc.retweets += record.metrics?.retweetCount ?? 0;
        return acc;
      },
      { impressions: 0, engagements: 0, likes: 0, retweets: 0 }
    );
  const metricTone = METRIC_OPTIONS.find((option) => option.value === metric)?.tone ?? "green";
  const windowTotal = metric === "impressions"
    ? filteredTotals.impressions
    : metric === "engagements"
      ? filteredTotals.engagements
      : metric === "likes"
        ? filteredTotals.likes
        : filteredTotals.retweets;
  const peakValue = Math.max(...displayPoints.map((point) => point.metricValue), 0);
  const averageValue = displayPoints.length > 0 ? Math.round(windowTotal / displayPoints.length) : 0;


  return (
    <section className={`card timeline-card timeline-tone-${metricTone} timeline-card-ready`}>
      <div className="card-header timeline-header">
        <div>
          <h3>Performance timeline</h3>
          <span className="card-sub">{formatRangeLabel(range, filtered.length)}</span>
        </div>
        <div className="timeline-header-badges">
          <span className="timeline-badge">{view === "daily" ? "Daily rollup" : "Per-post"}</span>
          {allSeriesMeta.map((entry) => {
            const isHidden = hiddenSeries.has(entry.seriesKey);
            return (
              <button
                key={entry.seriesKey}
                type="button"
                onClick={() => toggleSeries(entry.seriesKey)}
                className={`timeline-badge timeline-badge-platform ${isHidden ? "is-hidden" : ""}`}
              >
                <i
                  className="chart-legend-dot"
                  style={{
                    background: isHidden ? "transparent" : entry.color,
                    boxShadow: isHidden ? "none" : `0 0 12px ${entry.color}55`,
                    borderColor: entry.color,
                    borderWidth: isHidden ? "2px" : "0",
                    borderStyle: "solid",
                  }}
                />
                <span className={`timeline-platform-tag timeline-platform-tag-${entry.platform}`}>
                  {entry.platform === "x" ? "X" : "T"}
                </span>
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="timeline-controls">
        <div className="timeline-control-group">
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`timeline-chip timeline-chip-metric ${metric === option.value ? "is-active" : ""}`}
              onClick={() => handleMetricChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="timeline-control-group">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`timeline-chip ${range === option.value ? "is-active" : ""}`}
              onClick={() => handleRangeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="timeline-selects">
          <label className="timeline-select">
            <span>Sport</span>
            <select value={sport} onChange={(event) => handleSportChange(event.target.value)}>
              <option value="all">All sports</option>
              {sports.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </select>
          </label>

          <label className="timeline-select">
            <span>View</span>
            <select value={view} onChange={(event) => handleViewChange(event.target.value as ChartView)}>
              {VIEW_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="timeline-summary-strip">
        <div className="timeline-summary-item">
          <span className="timeline-summary-label">Total</span>
          <strong>{formatMetricValue(windowTotal)}</strong>
        </div>
        <div className="timeline-summary-item">
          <span className="timeline-summary-label">Peak</span>
          <strong>{formatMetricValue(peakValue)}</strong>
        </div>
        <div className="timeline-summary-item">
          <span className="timeline-summary-label">Average</span>
          <strong>{formatMetricValue(averageValue)}</strong>
        </div>
        <div className="timeline-summary-item">
          <span className="timeline-summary-label">Points</span>
          <strong>{displayPoints.length}</strong>
        </div>
      </div>

      {displayPoints.length > 0 ? (
        <div key={animationSeed} className="timeline-stage-shell timeline-stage-shell-ready">
          <div className="timeline-stage">
            <div
              className="timeline-chart-wrap"
              ref={chartWrapRef}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
              onClick={handleChartClick}
              style={{ cursor: "crosshair" }}
            >
              <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <pattern id={gridId} width="120" height="60" patternUnits="userSpaceOnUse">
                    <path d="M120 0H0V60" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1" />
                  </pattern>
                  {seriesGeometry.map((entry) => (
                    <linearGradient key={entry.seriesKey} id={`${baseId}-${entry.seriesKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={entry.gradientStart} />
                      <stop offset="100%" stopColor={entry.gradientEnd} />
                    </linearGradient>
                  ))}
                </defs>

                <rect width={CHART_WIDTH} height={CHART_HEIGHT} fill={`url(#${gridId})`} />

                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const y = CHART_PADDING.top + innerHeight - innerHeight * step;
                  return (
                    <g key={step}>
                      <line
                        x1={CHART_PADDING.left}
                        x2={CHART_WIDTH - CHART_PADDING.right}
                        y1={y}
                        y2={y}
                        className="timeline-grid-line"
                        style={{ stroke: step === 0 ? "rgba(255,255,255,0.10)" : undefined }}
                        strokeDasharray={step === 0 ? "none" : "4 6"}
                      />
                      <text x={CHART_PADDING.left - 10} y={y + 3.5} textAnchor="end" className="timeline-grid-value">
                        {formatMetricValue(Math.round(maxValue * step))}
                      </text>
                    </g>
                  );
                })}

                {seriesGeometry.map((entry) => {
                  const isOtherFocused = focusSeriesKey !== null && focusSeriesKey !== entry.seriesKey;
                  const opacity = isOtherFocused ? 0.15 : 1;
                  const isXPlatform = entry.platform === "x";
                  return (
                    <g key={entry.seriesKey} style={{ opacity, transition: "opacity 0.2s ease" }}>
                      {entry.area ? <path d={entry.area} className="timeline-area" fill={`url(#${baseId}-${entry.seriesKey})`} /> : null}
                      {entry.line ? (
                        <path
                          d={entry.line}
                          className={`timeline-line ${isXPlatform ? "timeline-line-dashed" : ""}`}
                          pathLength={isXPlatform ? undefined : 1}
                          style={{
                            stroke: entry.color,
                            filter: `drop-shadow(0 6px 16px ${entry.color}40) drop-shadow(0 0 14px ${entry.color}25)`,
                            strokeWidth: activePoint?.seriesKey === entry.seriesKey ? 3.5 : 3,
                          }}
                        />
                      ) : null}
                    </g>
                  );
                })}

                {activeGeometry ? (
                  <line
                    x1={activeGeometry.x}
                    x2={activeGeometry.x}
                    y1={CHART_PADDING.top}
                    y2={CHART_HEIGHT - CHART_PADDING.bottom}
                    className="timeline-crosshair"
                  />
                ) : null}

                {geometry.map((point) => {
                  const isActive = activePoint?.key === point.key;
                  const isOtherFocused = focusSeriesKey !== null && focusSeriesKey !== point.seriesKey;
                  const opacity = isOtherFocused ? 0.15 : 1;
                  const color = seriesLookup.get(point.seriesKey)?.color ?? "#19c37d";
                  return (
                    <g key={point.key} style={{ opacity, transition: "opacity 0.2s ease" }}>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={isActive ? 9 : 6}
                        className={`timeline-point-ring ${isActive ? "is-active" : ""}`}
                        style={{
                          fill: isActive ? `${color}30` : `${color}18`,
                          stroke: isActive ? `${color}65` : `${color}40`,
                        }}
                      />
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={isActive ? 5.5 : 4}
                        className={`timeline-point ${isActive ? "is-active" : ""}`}
                        style={{ fill: color }}
                      />
                    </g>
                  );
                })}
              </svg>

              {activePoint && tooltipPos && activeSeriesMeta && (
                <div
                  className="ichart-tooltip"
                  style={{
                    left: tooltipPos.x,
                    top: tooltipPos.y,
                    transform: `translate(${tooltipPos.flipLeft ? "calc(-100% - 16px)" : "16px"}, -50%)`,
                    borderLeftColor: activeSeriesMeta.color,
                  }}
                >
                  <div className="ichart-tooltip-header">
                    <span className="ichart-tooltip-date">{activePoint.label}</span>
                    <span className="ichart-tooltip-sport">{activeSeriesMeta.label}</span>
                  </div>
                  <div className="ichart-tooltip-primary" style={{ color: activeSeriesMeta.color }}>
                    {new Intl.NumberFormat("en-US").format(activePoint.metricValue)}
                    <span>{METRIC_OPTIONS.find((o) => o.value === metric)?.label}</span>
                  </div>
                  <div className="ichart-tooltip-grid">
                    <div><span>Impressions</span><strong>{formatMetricValue(activePoint.impressions)}</strong></div>
                    <div><span>Engagements</span><strong>{formatMetricValue(activePoint.engagements)}</strong></div>
                    <div><span>Likes</span><strong>{formatMetricValue(activePoint.likes)}</strong></div>
                    <div><span>Retweets</span><strong>{formatMetricValue(activePoint.retweets)}</strong></div>
                  </div>
                  {view === "daily" && activePoint.posts > 1 && (
                    <div className="ichart-tooltip-angle">{activePoint.posts} posts rolled up</div>
                  )}
                </div>
              )}

              <div className="timeline-axis">
                {ticks.map((point) => (
                  <div
                    key={point.key}
                    className={`timeline-axis-item timeline-axis-item-${point.align} ${activePoint?.key === point.key ? "is-active" : ""}`}
                    style={{ left: `${(point.x / CHART_WIDTH) * 100}%` }}
                  >
                    <strong>{point.primary}</strong>
                    {point.secondary ? <span>{point.secondary}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="timeline-footer">
            <div className="timeline-active-card">
              <div className="timeline-active-top">
                <div>
                  <span className="timeline-active-kicker">Active point</span>
                  <h4>{activePoint?.label ?? "—"}</h4>
                </div>
                <span className="timeline-active-sport">{activeSeriesMeta ? `${activeSeriesMeta.label} · ${activePoint?.sport.toUpperCase()}` : "—"}</span>
              </div>

              <div className="timeline-active-grid">
                <div>
                  <span>Impressions</span>
                  <strong>{formatMetricValue(activePoint?.impressions ?? 0)}</strong>
                </div>
                <div>
                  <span>Engagements</span>
                  <strong>{formatMetricValue(activePoint?.engagements ?? 0)}</strong>
                </div>
                <div>
                  <span>Likes</span>
                  <strong>{formatMetricValue(activePoint?.likes ?? 0)}</strong>
                </div>
                <div>
                  <span>Retweets</span>
                  <strong>{formatMetricValue(activePoint?.retweets ?? 0)}</strong>
                </div>
              </div>

              <p className="timeline-footnote">
                {focusSeriesKey && activeSeriesMeta
                  ? `Focusing on ${activeSeriesMeta.label}. Click anywhere to reset.`
                  : view === "daily"
                  ? `${activePoint?.posts ?? 0} posts rolled into this day. Click a line to isolate it.`
                  : "Timeline uses actual publish timestamps. Click a line to isolate it."}
              </p>
            </div>

            <div className="timeline-actions">
              {activePoint?.tweetId ? (
                <a className="view-link" href={`https://x.com/i/web/status/${activePoint.tweetId}`} target="_blank" rel="noopener noreferrer">
                  View on X &#8599;
                </a>
              ) : (
                <span className="timeline-footnote" style={{ margin: 0 }}>Hover a point to inspect.</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state" style={{ margin: "1rem" }}>No tracked posts match the selected filters.</div>
      )}
    </section>
  );
}
