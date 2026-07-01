import type {
  BestEffort,
  LatLngBounds,
  Sport,
  Split,
  TrackPoint,
  WorkoutSummary,
} from '@/model/workout';

const EARTH_RADIUS_M = 6371000;
// Below this speed we treat the athlete as stopped (auto-pause).
const MOVING_SPEED_THRESHOLD_MS = 0.5;
// Hysteresis on the *smoothed* elevation series before counting a gain/loss.
const ELEV_HYSTERESIS_M = 0.4;
// Standard best-effort distances to scan for (meters).
const BEST_EFFORT_TARGETS = [1000, 5000, 10000, 21097];

export interface DeriveOptions {
  maxHr?: number | null; // enables HR-zone breakdown when provided
}

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

/** Centered moving-average smoothing of a numeric series. */
function smooth(values: (number | null)[], window: number): (number | null)[] {
  const half = Math.floor(window / 2);
  return values.map((v, i) => {
    if (v == null) return null;
    let sum = 0;
    let n = 0;
    for (let j = i - half; j <= i + half; j++) {
      const x = values[j];
      if (j >= 0 && j < values.length && x != null) {
        sum += x;
        n++;
      }
    }
    return n ? sum / n : v;
  });
}

/**
 * Minetti energy-cost of running as a function of gradient (fraction, e.g. 0.1
 * = 10% uphill). Returns cost relative to flat, used to convert real distance
 * into flat-equivalent distance for grade-adjusted pace.
 */
function gradeCostFactor(grade: number): number {
  const g = Math.max(-0.45, Math.min(0.45, grade));
  const cr =
    155.4 * g ** 5 -
    30.4 * g ** 4 -
    43.3 * g ** 3 +
    46.3 * g ** 2 +
    19.5 * g +
    3.6;
  return cr / 3.6; // 3.6 J/kg/m is the flat cost
}

/** Five-zone model by percentage of max HR: Z1<60, Z2<70, Z3<80, Z4<90, Z5≥90. */
function hrZoneIndex(hr: number, maxHr: number): number {
  const pct = hr / maxHr;
  if (pct < 0.6) return 0;
  if (pct < 0.7) return 1;
  if (pct < 0.8) return 2;
  if (pct < 0.9) return 3;
  return 4;
}

/**
 * Scan for the fastest time covering each target distance, using cumulative
 * distance/time arrays and a two-pointer sweep. O(n) per target.
 */
function computeBestEfforts(
  cumDist: number[],
  cumTime: number[],
  totalDist: number,
): BestEffort[] {
  const out: BestEffort[] = [];
  for (const target of BEST_EFFORT_TARGETS) {
    if (totalDist < target) continue;
    let best = Infinity;
    let lo = 0;
    for (let hi = 0; hi < cumDist.length; hi++) {
      while (cumDist[hi] - cumDist[lo] >= target) {
        const dt = cumTime[hi] - cumTime[lo];
        if (dt < best) best = dt;
        lo++;
      }
    }
    if (Number.isFinite(best)) out.push({ distanceM: target, durationSec: best });
  }
  return out;
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
 */
export function deriveSummary(
  track: TrackPoint[],
  sport: Sport,
  opts: DeriveOptions = {},
): WorkoutSummary {
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
    hrZones: null,
    bestEfforts: [],
    bounds: null,
    routePreview: [],
  };
  if (track.length < 2) return empty;

  // Smooth the altitude series once, up front — used for both elevation totals
  // and grade-adjusted pace so hills are measured consistently.
  const smoothAlt = smooth(
    track.map((p) => p.alt),
    9,
  );

  let distanceM = 0;
  let movingMs = 0;
  let elevGainM = 0;
  let elevLossM = 0;
  let maxSpeedMs = 0;
  let flatEquivM = 0; // grade-adjusted equivalent distance (run)

  const hasMaxHr = opts.maxHr != null && opts.maxHr > 0;
  const hrZones = hasMaxHr ? [0, 0, 0, 0, 0] : null;

  // cumulative arrays for best-effort scanning
  const cumDist: number[] = [0];
  const cumTime: number[] = [0];

  // per-km split accumulation
  const splits: Split[] = [];
  let splitStartDist = 0;
  let splitStartMs = track[0].t;
  let splitStartAlt = smoothAlt[0];
  const splitHr: number[] = [];

  // elevation hysteresis reference on smoothed series
  let elevRef = smoothAlt[0];

  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1];
    const cur = track[i];
    const segDist = haversine(prev.lat, prev.lng, cur.lat, cur.lng);
    const segMs = cur.t - prev.t;
    const segSpeed = segMs > 0 ? segDist / (segMs / 1000) : 0;

    distanceM += segDist;
    cumDist.push(distanceM);
    cumTime.push(cur.t / 1000);

    const moving = segSpeed >= MOVING_SPEED_THRESHOLD_MS;
    if (moving) movingMs += segMs;
    if (segSpeed > maxSpeedMs) maxSpeedMs = segSpeed;

    // elevation: accumulate against a hysteresis reference on the smoothed series
    const a = smoothAlt[i];
    if (a != null && elevRef != null) {
      const d = a - elevRef;
      if (d > ELEV_HYSTERESIS_M) {
        elevGainM += d;
        elevRef = a;
      } else if (d < -ELEV_HYSTERESIS_M) {
        elevLossM += -d;
        elevRef = a;
      }
    } else if (a != null && elevRef == null) {
      elevRef = a;
    }

    // grade-adjusted equivalent distance (run only, on moving segments)
    if (sport === 'run' && moving && segDist > 0) {
      const prevA = smoothAlt[i - 1];
      const grade = prevA != null && a != null ? (a - prevA) / segDist : 0;
      flatEquivM += segDist * gradeCostFactor(grade);
    }

    // HR zone time
    if (hrZones && cur.hr != null && moving) {
      hrZones[hrZoneIndex(cur.hr, opts.maxHr!)] += segMs / 1000;
    }
    if (cur.hr != null) splitHr.push(cur.hr);

    // close a km split
    while (distanceM - splitStartDist >= 1000) {
      const durationSec = (cur.t - splitStartMs) / 1000;
      splits.push({
        index: splits.length,
        distanceM: 1000,
        durationSec,
        paceSecPerKm: durationSec,
        elevChangeM:
          a != null && splitStartAlt != null ? a - splitStartAlt : 0,
        avgHr: avg(splitHr),
      });
      splitStartDist += 1000;
      splitStartMs = cur.t;
      splitStartAlt = a;
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
    gradeAdjustedPaceSecPerKm:
      sport === 'run' && flatEquivM > 0
        ? durationMovingSec / (flatEquivM / 1000)
        : null,
    hrZones,
    bestEfforts: computeBestEfforts(cumDist, cumTime, distanceM),
    bounds: computeBounds(track),
    routePreview: routePreview(track),
  };
}
