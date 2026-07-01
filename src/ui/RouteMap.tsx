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

  const pts = path.map(project);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];

  return (
    <svg className="route-map" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <path
        d={d}
        fill="none"
        stroke="url(#aera-grad)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showEndpoints && (
        <>
          <circle cx={sx} cy={sy} r={strokeWidth + 1.5} fill="#2f8fff" />
          <circle cx={ex} cy={ey} r={strokeWidth + 1.5} fill="#ff5a1f" />
        </>
      )}
    </svg>
  );
}
