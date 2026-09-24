import type { Sport, TrackPoint } from '@/model/workout';
import { haversine, MAX_SPEED_MS } from './deriveSummary';

// Same gates as the phone recorder (record/engine.ts onSample).
const STATIONARY_SPEED_MS = 0.5; // slower than this = standing still
const NOISE_FLOOR_M = 4; // GPS wobble while standing still

/**
 * Pin GPS jitter in place: a point only moves the track when it's a real move
 * (≥ noise floor, not stationary speed, not a teleport). Otherwise it keeps the
 * previous position — time, HR etc. are kept. Used for raw watch recordings,
 * where standing still in a warm-up otherwise turns wobble into distance.
 */
export function denoiseTrack(points: TrackPoint[], sport: Sport): TrackPoint[] {
  if (points.length < 2) return points;
  const out: TrackPoint[] = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const seg = haversine(last.lat, last.lng, p.lat, p.lng);
    const dt = Math.max((p.t - last.t) / 1000, 0.001);
    const derived = seg / dt;
    const speed = p.speed ?? derived;
    const moved = seg >= NOISE_FLOOR_M && speed >= STATIONARY_SPEED_MS && derived <= MAX_SPEED_MS[sport];
    if (moved) {
      out.push(p);
      last = p;
    } else {
      out.push({ ...p, lat: last.lat, lng: last.lng });
    }
  }
  return out;
}
