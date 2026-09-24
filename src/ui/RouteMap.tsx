import type { LatLngBounds } from '@/model/workout';

/**
 * Minimalist no-basemap route render — the v1 map style. Projects [lat, lng]
 * points into the SVG box (equirectangular, latitude-corrected) and draws the
 * brand-gradient polyline. Same component powers feed thumbnails and detail.
 */
export function RouteMap({
  path,
  bounds,
  height = 160,
  strokeWidth = 3,
  padding = 12,
  showEndpoints = true,
}: {
  path: [number, number][];
  bounds: LatLngBounds | null;
  height?: number;
  strokeWidth?: number;
  padding?: number;
  showEndpoints?: boolean;
}) {
  const W = 400;
  const H = height;

  if (path.length < 2 || !bounds) {
    return <div className="route-empty" style={{ height: H }} />;
  }

  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 1e-6);
  const spanLng = Math.max((bounds.maxLng - bounds.minLng) * lngScale, 1e-6);

  // fit while preserving aspect ratio
  const innerW = W - padding * 2;
  const innerH = H - padding * 2;
  const scale = Math.min(innerW / spanLng, innerH / spanLat);
  const drawW = spanLng * scale;
  const drawH = spanLat * scale;
  const offX = padding + (innerW - drawW) / 2;
  const offY = padding + (innerH - drawH) / 2;

  const project = ([lat, lng]: [number, number]): [number, number] => {
    const x = offX + ((lng - bounds.minLng) * lngScale) * scale;
    const y = offY + (bounds.maxLat - lat) * scale; // invert Y
    return [x, y];
  };

  const pts = thin(path.map(project), 1.5);
  const d = smoothPath(pts);
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];

  return (
    <svg className="route-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <path
        d={d}
        fill="none"
        stroke="var(--color-accent-400)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndpoints && (
        <>
          <circle cx={sx} cy={sy} r={strokeWidth + 1.5} fill="var(--accent-2)" />
          <circle cx={ex} cy={ey} r={strokeWidth + 1.5} fill="var(--accent)" />
        </>
      )}
    </svg>
  );
}

/** Drop points closer than `minPx` to the last kept one (GPS jitter, overdraw). */
function thin(pts: [number, number][], minPx: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [lx, ly] = out[out.length - 1];
    if (Math.hypot(pts[i][0] - lx, pts[i][1] - ly) >= minPx) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Catmull-Rom through the points as cubic Béziers → curves instead of corners. */
function smoothPath(pts: [number, number][]): string {
  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
