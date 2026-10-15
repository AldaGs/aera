import { useEffect, useRef } from 'react';

/**
 * Dotted spinning orb shown over the share preview while a PNG is being made.
 * A trimmed take on the "MorphOrb" dot sphere, tinted with the app accents.
 */
const SIZE = 160;
const R = 52;
const RINGS = 14;

const DOTS: { x: number; y: number; z: number; u: number }[] = [];
for (let k = 0; k < RINGS; k++) {
  const y = 1 - ((k + 0.5) / RINGS) * 2;
  const r = Math.sqrt(1 - y * y);
  const m = Math.max(4, Math.round(28 * r));
  for (let j = 0; j < m; j++) {
    const a = (j / m) * Math.PI * 2 + k * 0.35;
    DOTS.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, u: (1 - y) / 2 });
  }
}

/** Resolve a CSS custom property to [r,g,b] by letting a canvas normalise it. */
function cssRgb(ctx: CanvasRenderingContext2D, name: string, fallback: string): number[] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  ctx.fillStyle = fallback;
  ctx.fillStyle = v;
  const hex = String(ctx.fillStyle);
  return hex.startsWith('#')
    ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    : (hex.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

export function SavingOrb() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = SIZE * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const a1 = cssRgb(ctx, '--accent', '#ff5a1f');
    const a2 = cssRgb(ctx, '--accent-2', '#2f8fff');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt), c0 = SIZE / 2;
    let raf = 0;
    const start = performance.now();

    const draw = (now: number) => {
      const t = reduced ? 1 : (now - start) / 1000;
      const yaw = t * 0.9, cy = Math.cos(yaw), sy = Math.sin(yaw);
      const band = Math.sin(t * 2.2); // a lit band sweeping up and down
      const intro = Math.min(1, t / 0.5);
      ctx.clearRect(0, 0, SIZE, SIZE);
      const pts = DOTS.map((d) => {
        const x1 = d.x * cy + d.z * sy, z1 = -d.x * sy + d.z * cy;
        const y2 = d.y * ct - z1 * st, z2 = d.y * st + z1 * ct;
        const f = 2.8 / (2.8 - z2), depth = (z2 + 1) / 2;
        const lit = Math.max(0, 1 - ((d.y - band) ** 2) / 0.03);
        return { x: c0 + x1 * R * f * intro, y: c0 - y2 * R * f * intro, depth, lit, u: d.u };
      }).sort((a, b) => a.depth - b.depth);
      for (const p of pts) {
        const c = a1.map((v, i) => Math.round(v + (a2[i] - v) * p.u));
        ctx.globalAlpha = Math.min(1, (0.15 + 0.5 * p.depth * p.depth + 0.7 * p.lit) * intro);
        ctx.fillStyle = `rgb(${c.join(',')})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (0.6 + 1.1 * p.depth) * (1 + 0.8 * p.lit), 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="saving-orb" role="status" aria-label="Preparing image">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
