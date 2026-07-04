import { useRef } from 'react';

export interface ChartPoint {
  x: number; // domain value (elapsed ms or cumulative meters)
  y: number | null; // series value; null = gap (e.g. paused / no data)
}

/**
 * Interactive line chart over a track series with a draggable scrubber. The
 * active x-position is lifted to the parent so several charts (HR, pace,
 * elevation…) share one guide line and read out the same moment in the workout.
 *
 * Pure SVG + a thin pointer overlay — no chart library, matching the house style.
 */
export function TrackChart({
  points,
  color = 'url(#aera-grad)',
  activeX,
  onScrub,
  format,
  formatX,
  height = 96,
}: {
  points: ChartPoint[];
  color?: string;
  activeX: number | null;
  onScrub: (x: number | null) => void;
  format: (y: number) => string;
  formatX: (x: number) => string;
  height?: number;
}) {
  const W = 400;
  const H = height;
  const pad = 8;
  const wrapRef = useRef<HTMLDivElement>(null);

  if (points.length < 2) return <div className="route-empty" style={{ height: H }} />;

  // Downsample for a light DOM.
  const maxPts = 200;
  const pts =
    points.length > maxPts
      ? Array.from({ length: maxPts }, (_, i) =>
          points[Math.round((i * (points.length - 1)) / (maxPts - 1))],
        )
      : points;

  const xMin = pts[0].x;
  const xMax = pts[pts.length - 1].x;
  const xSpan = Math.max(xMax - xMin, 1e-6);
  const ys = pts.map((p) => p.y).filter((v): v is number => v != null);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpan = Math.max(yMax - yMin, 1e-6);

  const sx = (x: number) => pad + ((x - xMin) / xSpan) * (W - pad * 2);
  const sy = (y: number) => pad + (1 - (y - yMin) / ySpan) * (H - pad * 2);

  // Build path, breaking at nulls.
  let d = '';
  let penDown = false;
  for (const p of pts) {
    if (p.y == null) {
      penDown = false;
      continue;
    }
    d += `${penDown ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)} `;
    penDown = true;
  }

  // Nearest sample to the active x, for the guide + tooltip.
  let active: ChartPoint | null = null;
  if (activeX != null) {
    let best = Infinity;
    for (const p of pts) {
      if (p.y == null) continue;
      const dist = Math.abs(p.x - activeX);
      if (dist < best) {
        best = dist;
        active = p;
      }
    }
  }

  function xFromEvent(clientX: number): number {
    const el = wrapRef.current;
    if (!el) return xMin;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return xMin + frac * xSpan;
  }

  return (
    <div
      ref={wrapRef}
      className="track-chart"
      style={{ height: H, touchAction: 'none' }}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore — capture is a nicety, not required for the read-out
        }
        onScrub(xFromEvent(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        onScrub(xFromEvent(e.clientX));
      }}
      onPointerUp={() => onScrub(null)}
      onPointerLeave={(e) => {
        if (e.buttons !== 0) onScrub(null);
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="track-chart-svg">
        <path d={d.trim()} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
        {active && (
          <>
            <line
              x1={sx(active.x)}
              y1={0}
              x2={sx(active.x)}
              y2={H}
              stroke="#ffffff"
              strokeOpacity={0.35}
              strokeWidth={1}
            />
            <circle cx={sx(active.x)} cy={sy(active.y!)} r={4} fill="#fff" />
          </>
        )}
      </svg>
      {active && (
        <div
          className="track-chart-tip"
          style={{ left: `${((active.x - xMin) / xSpan) * 100}%` }}
        >
          <span className="track-chart-tip-val">{format(active.y!)}</span>
          <span className="track-chart-tip-x">{formatX(active.x)}</span>
        </div>
      )}
    </div>
  );
}
