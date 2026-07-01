import type {
  LatLngBounds,
  Sport,
  Split,
  TrackPoint,
  WorkoutSummary,
} from '@/model/workout';

const EARTH_RADIUS_M = 6371000;
// Below this speed we treat the athlete as stopped (auto-pause).
const MOVING_SPEED_THRESHOLD_MS = 0.5;
// Ignore sub-noise altitude wobble when summing elevation gain.
const ELEV_NOISE_THRESHOLD_M = 1;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters. */
export function haversine(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function computeBounds(track: TrackPoint[]): LatLngBounds | null {
  if (track.length === 0) return null;
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const p of track) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Downsample the track to ~maxPts [lat, lng] pairs for cheap thumbnails. */
function routePreview(track: TrackPoint[], maxPts = 48): [number, number][] {
  if (track.length === 0) return [];
  if (track.length <= maxPts)
    return track.map((p) => [p.lat, p.lng] as [number, number]);
  const step = (track.length - 1) / (maxPts - 1);
  const out: [number, number][] = [];
  for (let i = 0; i < maxPts; i++) {
    const p = track[Math.round(i * step)];
    out.push([p.lat, p.lng]);
  }
  return out;
}

function avg(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Pure function: derive the cached summary from the raw track.
 * Source of truth stays the track; improve this and re-run over stored workouts.
 *
 * NOTE: v1 baseline. Elevation smoothing, grade-adjusted pace, and best-effort
 * segments are stubbed to null and will land in the metrics-engine pass.
 */
export function deriveSummary(track: TrackPoint[], sport: Sport): WorkoutSummary {
  const empty: WorkoutSummary = {
    durationMovingSec: 0,
    durationElapsedSec: 0,
    distanceM: 0,
    avgPaceSecPerKm: null,
    avgSpeedKmh: null,
    elevGainM: 0,
    elevLossM: 0,
    avgHr: null,
    maxHr: null,
    calories: null,
    splits: [],
    maxSpeedKmh: null,
    gradeAdjustedPaceSecPerKm: null,
    bounds: null,
    routePreview: [],
  };
  if (track.length < 2) return empty;

  let distanceM = 0;
  let movingMs = 0;
  let elevGainM = 0;
  let elevLossM = 0;
  let maxSpeedMs = 0;

  // per-km split accumulation
  const splits: Split[] = [];
  let splitStartDist = 0;
  let splitStartMs = track[0].t;
  let splitStartAlt = track[0].alt;
  const splitHr: number[] = [];

  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1];
    const cur = track[i];
    const segDist = haversine(prev.lat, prev.lng, cur.lat, cur.lng);
    const segMs = cur.t - prev.t;
    const segSpeed = segMs > 0 ? segDist / (segMs / 1000) : 0;

    distanceM += segDist;
    if (segSpeed >= MOVING_SPEED_THRESHOLD_MS) movingMs += segMs;
    if (segSpeed > maxSpeedMs) maxSpeedMs = segSpeed;

    if (prev.alt != null && cur.alt != null) {
      const dAlt = cur.alt - prev.alt;
      if (dAlt > ELEV_NOISE_THRESHOLD_M) elevGainM += dAlt;
      else if (dAlt < -ELEV_NOISE_THRESHOLD_M) elevLossM += -dAlt;
    }
    if (cur.hr != null) splitHr.push(cur.hr);

    // close a km split
    while (distanceM - splitStartDist >= 1000) {
      const durationSec = (cur.t - splitStartMs) / 1000;
      splits.push({
        index: splits.length,
        distanceM: 1000,
        durationSec,
        paceSecPerKm: durationSec, // 1km → sec/km == durationSec
        elevChangeM:
          cur.alt != null && splitStartAlt != null ? cur.alt - splitStartAlt : 0,
        avgHr: avg(splitHr),
      });
      splitStartDist += 1000;
      splitStartMs = cur.t;
      splitStartAlt = cur.alt;
      splitHr.length = 0;
    }
  }

  const durationElapsedSec = (track[track.length - 1].t - track[0].t) / 1000;
  const durationMovingSec = movingMs / 1000;
  const distanceKm = distanceM / 1000;

  const hrValues = track.map((p) => p.hr).filter((v): v is number => v != null);

  return {
    durationMovingSec,
    durationElapsedSec,
    distanceM,
    avgPaceSecPerKm:
      sport === 'run' && distanceKm > 0 ? durationMovingSec / distanceKm : null,
    avgSpeedKmh:
      sport === 'ride' && durationMovingSec > 0
        ? distanceKm / (durationMovingSec / 3600)
        : null,
    elevGainM,
    elevLossM,
    avgHr: avg(hrValues),
    maxHr: hrValues.length ? Math.max(...hrValues) : null,
    calories: null,
    splits,
    maxSpeedKmh: maxSpeedMs * 3.6,
    gradeAdjustedPaceSecPerKm: null,
    bounds: computeBounds(track),
    routePreview: routePreview(track),
  };
}
