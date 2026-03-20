"use client";

import { useId, useRef, useState } from "react";
import { buildSmoothAreaPath, buildSmoothLinePath } from "../lib/chartPaths";

export interface ChartPost {
  postedAt: string;
  sport: string;
  angle: string;
  impressions: number;
  engagements: number;
  likes: number;
  retweets: number;
  replies: number;
  bookmarks: number;
}

export interface AnalyticsChartSeries {
  id: string;
  label: string;
  color: string;
  gradientStart: string;
  gradientEnd: string;
  posts: ChartPost[];
}

interface InteractiveAnalyticsChartProps {
  series: AnalyticsChartSeries[];
  metric: "impressions" | "engagements";
}

const W = 800;
const H = 260;
const PAD = { top: 16, right: 16, bottom: 16, left: 54 };

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function fmtFull(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export default function InteractiveAnalyticsChart({
  series,
  metric,
}: InteractiveAnalyticsChartProps) {
  const baseId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; flipLeft: boolean } | null>(null);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const activeSeries = series.filter((entry) => entry.posts.length > 0);
  const allPosts = activeSeries.flatMap((entry) => entry.posts);
  const timestamps = allPosts.map((post) => Date.parse(post.postedAt)).filter((value) => !Number.isNaN(value));
  const minTime = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const maxTime = timestamps.length > 0 ? Math.max(...timestamps) : 1;
  const maxVal = Math.max(
    ...activeSeries.flatMap((entry) => entry.posts.map((post) => (metric === "impressions" ? post.impressions : post.engagements))),
    1
  );
  const baselineY = PAD.top + innerH;

  const seriesGeometry = activeSeries.map((entry) => {
    const points = entry.posts.map((post, index) => {
      const value = metric === "impressions" ? post.impressions : post.engagements;
      const timestamp = Date.parse(post.postedAt);
      const normalizedX =
        entry.posts.length === 1 || maxTime === minTime || Number.isNaN(timestamp)
          ? 0.5
          : (timestamp - minTime) / Math.max(maxTime - minTime, 1);
      return {
        key: `${entry.id}-${index}-${post.postedAt}`,
        x: PAD.left + normalizedX * innerW,
        y: PAD.top + innerH - (value / maxVal) * innerH,
        value,
        post,
      };
    });

    return {
      ...entry,
      gradId: `${baseId}-${entry.id}`,
      points,
      line: buildSmoothLinePath(points),
      area: buildSmoothAreaPath(points, baselineY),
    };
  });

  const allPoints = seriesGeometry.flatMap((entry) =>
    entry.points.map((point) => ({
      ...point,
      seriesId: entry.id,
      seriesLabel: entry.label,
      color: entry.color,
    }))
  );

  const maxLabels = 6;
  const labelIndices: number[] = [];
  if (allPosts.length > 0) {
    const sortedPosts = [...allPosts].sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
    const step = Math.max(1, Math.floor(sortedPosts.length / maxLabels));
    for (let i = 0; i < sortedPosts.length; i += step) labelIndices.push(i);
    if (labelIndices[labelIndices.length - 1] !== sortedPosts.length - 1) labelIndices.push(sortedPosts.length - 1);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!wrapRef.current || allPoints.length === 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * W;

    let closest = allPoints[0];
    let closestDist = Infinity;
    for (const point of allPoints) {
      const dist = Math.abs(point.x - svgX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = point;
      }
    }

    setHoverKey(closest.key);
    const ptScreenX = (closest.x / W) * rect.width;
    const ptScreenY = (closest.y / H) * rect.height;
    setTooltipPos({ x: ptScreenX, y: ptScreenY, flipLeft: ptScreenX > rect.width * 0.65 });
  }

  function handleMouseLeave() {
    setHoverKey(null);
    setTooltipPos(null);
  }

  const hoveredPoint = hoverKey ? allPoints.find((point) => point.key === hoverKey) ?? null : null;
  const sortedPosts = [...allPosts].sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));

  return (
    <div className="ichart-wrap">
      {activeSeries.length > 1 && (
        <div className="chart-legend">
          {activeSeries.map((entry) => (
            <span key={entry.id} className="chart-legend-item">
              <i className="chart-legend-dot" style={{ background: entry.color, boxShadow: `0 0 12px ${entry.color}55` }} />
              {entry.label}
            </span>
          ))}
        </div>
      )}
      <div
        ref={wrapRef}
        className="ichart-svg-area"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            {seriesGeometry.map((entry) => (
              <linearGradient key={entry.gradId} id={entry.gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={entry.gradientStart} />
                <stop offset="100%" stopColor={entry.gradientEnd} />
              </linearGradient>
            ))}
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((step) => {
            const y = PAD.top + innerH - innerH * step;
            return (
              <g key={step}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                  stroke={step === 0 ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)"}
                  strokeWidth="1"
                  strokeDasharray={step === 0 ? "none" : "4 6"}
                />
                <text
                  x={PAD.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="ichart-grid-value"
                >
                  {fmt(Math.round(maxVal * step))}
                </text>
              </g>
            );
          })}

          {seriesGeometry.map((entry) => (
            <g key={entry.id}>
              {entry.area && <path d={entry.area} fill={`url(#${entry.gradId})`} className="ichart-area" />}
              {entry.line && (
                <path
                  d={entry.line}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={hoveredPoint?.seriesId === entry.id ? 3 : 2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="ichart-line"
                  style={{ filter: `drop-shadow(0 6px 16px ${entry.color}40) drop-shadow(0 0 12px ${entry.color}25)` }}
                />
              )}
            </g>
          ))}

          {hoveredPoint && (
            <line
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          )}

          {allPoints.map((point) => {
            const isHovered = point.key === hoverKey;
            return (
              <g key={point.key}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? 7 : 4}
                  fill={isHovered ? `${point.color}20` : `${point.color}10`}
                  stroke={isHovered ? `${point.color}50` : `${point.color}30`}
                  strokeWidth="1"
                  className="ichart-point-ring"
                />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isHovered ? 3.8 : 2.5}
                  fill={point.color}
                  className="ichart-point"
                />
              </g>
            );
          })}
        </svg>

        {hoveredPoint && tooltipPos && (
          <div
            className="ichart-tooltip"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: `translate(${tooltipPos.flipLeft ? "calc(-100% - 14px)" : "14px"}, -50%)`,
              borderLeftColor: hoveredPoint.color,
            }}
          >
            <div className="ichart-tooltip-header">
              <span className="ichart-tooltip-date">{fmtDate(hoveredPoint.post.postedAt)}</span>
              <span className="ichart-tooltip-sport">{hoveredPoint.seriesLabel}</span>
            </div>
            <div className="ichart-tooltip-primary" style={{ color: hoveredPoint.color }}>
              {fmtFull(hoveredPoint.value)}
              <span>{metric === "impressions" ? "impressions" : "engagements"}</span>
            </div>
            <div className="ichart-tooltip-grid">
              <div><span>Likes</span><strong>{fmt(hoveredPoint.post.likes)}</strong></div>
              <div><span>Reposts</span><strong>{fmt(hoveredPoint.post.retweets)}</strong></div>
              <div><span>Replies</span><strong>{fmt(hoveredPoint.post.replies)}</strong></div>
              <div><span>Bookmarks</span><strong>{fmt(hoveredPoint.post.bookmarks)}</strong></div>
            </div>
            {hoveredPoint.post.angle && hoveredPoint.post.angle !== "unknown" && (
              <div className="ichart-tooltip-angle">{hoveredPoint.post.sport} · {hoveredPoint.post.angle}</div>
            )}
          </div>
        )}
      </div>

      <div className="ichart-axis">
        {labelIndices.map((idx) => (
          <span
            key={idx}
            className={hoveredPoint?.post.postedAt === sortedPosts[idx]?.postedAt ? "is-active" : ""}
          >
            {sortedPosts[idx] ? fmtShortDate(sortedPosts[idx].postedAt) : "--"}
          </span>
        ))}
      </div>
    </div>
  );
}
