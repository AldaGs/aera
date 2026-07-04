import type { Workout } from '@/model/workout';
import { fmtDistance, fmtDuration, fmtPace, fmtSpeed } from '@/format';

export type Template = 'story' | 'square' | 'poster';

export interface TemplateSpec {
  id: Template;
  label: string;
  w: number;
  h: number;
}

export const TEMPLATES: TemplateSpec[] = [
  { id: 'story', label: 'Story 9:16', w: 1080, h: 1920 },
  { id: 'square', label: 'Square 1:1', w: 1080, h: 1080 },
  { id: 'poster', label: 'Route', w: 1080, h: 1350 },
];

const ACCENT = '#ff5a1f';
const ACCENT_2 = '#2f8fff';

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!);
}

/** Project a [lat,lng] path into a box, latitude-corrected, aspect-preserving. */
function projectPath(
  path: [number, number][],
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  box: { x: number; y: number; w: number; h: number },
  pad: number,
): [number, number][] {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 1e-6);
  const spanLng = Math.max((bounds.maxLng - bounds.minLng) * lngScale, 1e-6);
  const innerW = box.w - pad * 2;
  const innerH = box.h - pad * 2;
  const scale = Math.min(innerW / spanLng, innerH / spanLat);
  const drawW = spanLng * scale;
  const drawH = spanLat * scale;
  const offX = box.x + pad + (innerW - drawW) / 2;
  const offY = box.y + pad + (innerH - drawH) / 2;
  return path.map(([lat, lng]) => [
    offX + (lng - bounds.minLng) * lngScale * scale,
    offY + (bounds.maxLat - lat) * scale,
  ]);
}

interface StatCell {
  value: string;
  label: string;
}

function statCells(w: Workout): StatCell[] {
  const s = w.summary;
  const isRun = w.sport === 'run';
  return [
    { value: fmtDistance(s.distanceM), label: 'Distance' },
    { value: fmtDuration(s.durationMovingSec), label: 'Time' },
    {
      value: isRun ? fmtPace(s.avgPaceSecPerKm) : fmtSpeed(s.avgSpeedKmh),
      label: isRun ? 'Pace' : 'Speed',
    },
    { value: `${Math.round(s.elevGainM)} m`, label: 'Elevation' },
  ];
}

/**
 * Build a self-contained share-card SVG string for a workout. Self-contained
 * means all gradients/fonts are inline so it rasterizes identically off-DOM.
 * The same SVG powers the on-screen preview and the exported PNG.
 */
export function renderShareCard(
  w: Workout,
  spec: TemplateSpec,
  athleteName: string,
): string {
  if (spec.id === 'poster') return renderPoster(w, spec, athleteName);
  const { w: W, h: H } = spec;
  const isStory = spec.id === 'story';
  const s = w.summary;

  // Layout regions.
  const margin = 72;
  const headerY = isStory ? 150 : 96;
  const mapBox = {
    x: margin,
    y: isStory ? 280 : 210,
    w: W - margin * 2,
    h: isStory ? 980 : 560,
  };
  const statsY = mapBox.y + mapBox.h + (isStory ? 130 : 90);

  // Route path.
  let routeSvg = '';
  if (s.routePreview.length >= 2 && s.bounds) {
    const pts = projectPath(s.routePreview, s.bounds, mapBox, 90);
    const d = pts
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    const [sx, sy] = pts[0];
    const [ex, ey] = pts[pts.length - 1];
    routeSvg = `
      <path d="${d}" fill="none" stroke="url(#route)" stroke-width="12"
        stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="18" fill="${ACCENT_2}"/>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="18" fill="${ACCENT}"/>`;
  }

  // Stats row.
  const cells = statCells(w);
  const colW = (W - margin * 2) / cells.length;
  const statsSvg = cells
    .map((c, i) => {
      const cx = margin + colW * i + colW / 2;
      return `
        <text x="${cx.toFixed(1)}" y="${statsY}" fill="#ffffff" font-size="52"
          font-weight="800" text-anchor="middle">${esc(c.value)}</text>
        <text x="${cx.toFixed(1)}" y="${statsY + 46}" fill="#8a8a99" font-size="26"
          font-weight="600" letter-spacing="2" text-anchor="middle">${esc(
            c.label.toUpperCase(),
          )}</text>`;
    })
    .join('');

  const sportLabel = w.sport === 'run' ? 'RUN' : w.sport === 'walk' ? 'WALK' : 'RIDE';
  const date = new Date(w.startedAt).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const footerY = H - (isStory ? 110 : 70);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#15151d"/>
      <stop offset="100%" stop-color="#08080c"/>
    </linearGradient>
    <linearGradient id="route" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_2}"/>
    </linearGradient>
    <linearGradient id="mapbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#20202b"/>
      <stop offset="100%" stop-color="#111119"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_2}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <text x="${margin}" y="${headerY}" fill="url(#brand)" font-size="30"
    font-weight="800" letter-spacing="6">${sportLabel} · ${esc(athleteName.toUpperCase())}</text>
  <text x="${margin}" y="${headerY + 68}" fill="#ffffff" font-size="64"
    font-weight="800">${esc(w.title)}</text>
  <text x="${margin}" y="${headerY + 116}" fill="#8a8a99" font-size="30"
    font-weight="600">${esc(date)}</text>

  <rect x="${mapBox.x}" y="${mapBox.y}" width="${mapBox.w}" height="${mapBox.h}"
    rx="40" fill="url(#mapbg)"/>
  ${routeSvg}

  ${statsSvg}

  <text x="${margin}" y="${footerY}" fill="url(#brand)" font-size="48"
    font-weight="800" letter-spacing="1">aera</text>
  ${
    s.gradeAdjustedPaceSecPerKm != null
      ? `<text x="${W - margin}" y="${footerY}" fill="#8a8a99" font-size="28"
    font-weight="600" text-anchor="end">GAP ${esc(fmtPace(s.gradeAdjustedPaceSecPerKm))}</text>`
      : ''
  }
</svg>`;
}

/**
 * Minimalist "route poster": a single brand-gradient route line filling the
 * canvas over a clean dark ground, with a slim stat footer. An art-print take on
 * the workout — the second share style.
 */
function renderPoster(w: Workout, spec: TemplateSpec, athleteName: string): string {
  const { w: W, h: H } = spec;
  const s = w.summary;
  const margin = 96;
  const mapBox = { x: margin, y: margin, w: W - margin * 2, h: H - 360 };

  let routeSvg = '';
  if (s.routePreview.length >= 2 && s.bounds) {
    const pts = projectPath(s.routePreview, s.bounds, mapBox, 40);
    const d = pts
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    const [ex, ey] = pts[pts.length - 1];
    routeSvg = `
      <path d="${d}" fill="none" stroke="url(#route)" stroke-width="14"
        stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="20" fill="${ACCENT}"/>`;
  } else {
    routeSvg = `<text x="${W / 2}" y="${mapBox.y + mapBox.h / 2}" fill="#3a3a46"
      font-size="40" font-weight="700" text-anchor="middle">No route</text>`;
  }

  const cells = statCells(w);
  const colW = (W - margin * 2) / cells.length;
  const statsY = H - 150;
  const statsSvg = cells
    .map((c, i) => {
      const cx = margin + colW * i + colW / 2;
      return `
        <text x="${cx.toFixed(1)}" y="${statsY}" fill="#ffffff" font-size="46"
          font-weight="800" text-anchor="middle">${esc(c.value)}</text>
        <text x="${cx.toFixed(1)}" y="${statsY + 40}" fill="#8a8a99" font-size="22"
          font-weight="600" letter-spacing="2" text-anchor="middle">${esc(
            c.label.toUpperCase(),
          )}</text>`;
    })
    .join('');

  const date = new Date(w.startedAt).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="route" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_2}"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="100%" stop-color="${ACCENT_2}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0b0b0f"/>
  ${routeSvg}

  <text x="${margin}" y="${H - 230}" fill="#ffffff" font-size="40"
    font-weight="800">${esc(w.title)}</text>
  <text x="${margin}" y="${H - 190}" fill="#8a8a99" font-size="26"
    font-weight="600">${esc(athleteName)} · ${esc(date)}</text>

  ${statsSvg}

  <text x="${W / 2}" y="${H - 56}" fill="url(#brand)" font-size="40"
    font-weight="800" letter-spacing="2" text-anchor="middle">aera</text>
</svg>`;
}

/** Rasterize an SVG string to a PNG blob at its native pixel size. */
export function svgToPngBlob(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('no 2d context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg load failed'));
    };
    img.src = url;
  });
}
