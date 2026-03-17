"use client";

import { useId, useRef, useState } from "react";
import { buildSmoothAreaPath, buildSmoothLinePath } from "../lib/chartPaths";

interface ChartPost {
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

interface InteractiveAnalyticsChartProps {
  posts: ChartPost[];
  metric: "impressions" | "engagements";
  color: string;
  gradientStart: string;
  gradientEnd: string;
}

const W = 800;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 12, left: 12 };

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
  posts,
  metric,
  color,
  gradientStart,
  gradientEnd,
}: InteractiveAnalyticsChartProps) {
  const gradId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number; flipLeft: boolean } | null>(null);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const values = posts.map((p) => (metric === "impressions" ? p.impressions : p.engagements));
  const maxVal = Math.max(...values, 1);

  const points = values.map((v, i) => ({
    x: PAD.left + (posts.length === 1 ? innerW / 2 : (i / Math.max(posts.length - 1, 1)) * innerW),
    y: PAD.top + innerH - (v / maxVal) * innerH,
  }));

  const baselineY = PAD.top + innerH;
  const line = buildSmoothLinePath(points);
  const area = buildSmoothAreaPath(points, baselineY);

  const maxLabels = 6;
  const labelIndices: number[] = [];
  if (posts.length > 0) {
    const step = Math.max(1, Math.floor(posts.length / maxLabels));
    for (let i = 0; i < posts.length; i += step) labelIndices.push(i);
    if (labelIndices[labelIndices.length - 1] !== posts.length - 1) labelIndices.push(posts.length - 1);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!wrapRef.current || posts.length === 0) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * W;

    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - svgX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    }

    setHoverIdx(closest);
    const ptScreenX = (points[closest].x / W) * rect.width;
    const ptScreenY = (points[closest].y / H) * rect.height;
    setTooltipPos({ x: ptScreenX, y: ptScreenY, flipLeft: ptScreenX > rect.width * 0.65 });
  }

  function handleMouseLeave() {
    setHoverIdx(null);
    setTooltipPos(null);
  }

  const hoveredPost = hoverIdx !== null ? posts[hoverIdx] : null;
  const hoveredValue = hoverIdx !== null ? values[hoverIdx] : null;
  const hoveredPoint = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="ichart-wrap">
      <div
        ref={wrapRef}
        className="ichart-svg-area"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradientStart} />
              <stop offset="100%" stopColor={gradientEnd} />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((step) => {
            const y = PAD.top + innerH - innerH * step;
            return (
              <line
                key={step}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="1"
              />
            );
          })}

          {area && <path d={area} fill={`url(#${gradId})`} className="ichart-area" />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="ichart-line"
              style={{ filter: `drop-shadow(0 3px 8px ${color}40)` }}
            />
          )}

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

          {points.map((pt, i) => {
            const isHovered = i === hoverIdx;
            return (
              <g key={i}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 6 : 0}
                  fill={`${color}20`}
                  stroke={`${color}50`}
                  strokeWidth="1"
                  style={{ transition: "r 0.15s ease" }}
                />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={isHovered ? 3.5 : 0}
                  fill={color}
                  style={{ transition: "r 0.15s ease" }}
                />
              </g>
            );
          })}
        </svg>

        {hoveredPost && tooltipPos && (
          <div
            className="ichart-tooltip"
            style={{
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: `translate(${tooltipPos.flipLeft ? "calc(-100% - 14px)" : "14px"}, -50%)`,
            }}
          >
            <div className="ichart-tooltip-header">
              <span className="ichart-tooltip-date">{fmtDate(hoveredPost.postedAt)}</span>
              <span className="ichart-tooltip-sport">{hoveredPost.sport}</span>
            </div>
            <div className="ichart-tooltip-primary" style={{ color }}>
              {fmtFull(hoveredValue!)}
              <span>{metric === "impressions" ? "impressions" : "engagements"}</span>
            </div>
            <div className="ichart-tooltip-grid">
              <div><span>Likes</span><strong>{fmt(hoveredPost.likes)}</strong></div>
              <div><span>Reposts</span><strong>{fmt(hoveredPost.retweets)}</strong></div>
              <div><span>Replies</span><strong>{fmt(hoveredPost.replies)}</strong></div>
              <div><span>Bookmarks</span><strong>{fmt(hoveredPost.bookmarks)}</strong></div>
            </div>
            {hoveredPost.angle && hoveredPost.angle !== "unknown" && (
              <div className="ichart-tooltip-angle">{hoveredPost.angle}</div>
            )}
          </div>
        )}
      </div>

      <div className="ichart-axis">
        {labelIndices.map((idx) => (
          <span
            key={idx}
            className={hoverIdx === idx ? "is-active" : ""}
          >
            {fmtShortDate(posts[idx].postedAt)}
          </span>
        ))}
      </div>
    </div>
  );
}
