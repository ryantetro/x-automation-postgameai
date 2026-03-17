"use client";

type Point = {
  x: number;
  y: number;
};

function controlPoint(current: Point, previous: Point, next: Point, reverse = false): Point {
  const p = previous ?? current;
  const n = next ?? current;
  const smoothing = 0.18;
  const angle = Math.atan2(n.y - p.y, n.x - p.x) + (reverse ? Math.PI : 0);
  const length = Math.hypot(n.x - p.x, n.y - p.y) * smoothing;

  return {
    x: current.x + Math.cos(angle) * length,
    y: current.y + Math.sin(angle) * length,
  };
}

export function buildSmoothLinePath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;

  const [first, ...rest] = points;
  let path = `M${first.x.toFixed(2)},${first.y.toFixed(2)}`;

  rest.forEach((point, index) => {
    const current = points[index];
    const previous = points[index - 1] ?? current;
    const next = points[index + 2] ?? point;
    const startControl = controlPoint(current, previous, point);
    const endControl = controlPoint(point, current, next, true);

    path += ` C${startControl.x.toFixed(2)},${startControl.y.toFixed(2)} ${endControl.x.toFixed(2)},${endControl.y.toFixed(2)} ${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  });

  return path;
}

export function buildSmoothAreaPath(points: Point[], baselineY: number): string {
  const line = buildSmoothLinePath(points);
  if (!line || points.length === 0) return "";

  return `${line} L${points[points.length - 1].x.toFixed(2)},${baselineY.toFixed(2)} L${points[0].x.toFixed(2)},${baselineY.toFixed(2)} Z`;
}
