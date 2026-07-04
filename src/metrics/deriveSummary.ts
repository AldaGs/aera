import type {
  BestEffort,
  Lap,
  LatLngBounds,
  Sport,
  Split,
  TrackPoint,
  WorkoutSummary,
} from '@/model/workout';

const EARTH_RADIUS_M = 6371000;
// Below this speed we treat the athlete as stopped (auto-pause).
const MOVING_SPEED_THRESHOLD_MS = 0.5;
// Above this speed we treat a foot segment as "running" rather than walking —
// used to split interval workouts into run/rest laps (~2 m/s ≈ 8:20/km).
const RUN_SPEED_THRESHOLD_MS = 2.0;
// Hysteresis on the *smoothed* elevation series before counting a gain/loss.
const ELEV_HYSTERESIS_M = 0.4;
// Standard best-effort distances to scan for (meters).
const BEST_EFFORT_TARGETS = [1000, 5000, 10000, 21097];

export interface DeriveOptions {
  maxHr?: number | null; // enables HR-zone breakdown when provided
  restingHr?: number | null; // enables TRIMP training-load when provided with maxHr
  weightKg?: number | null; // enables the calorie estimate (defaults to 70)
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

/** Whether pace (min/km) applies to this sport. */
function usesPace(sport: Sport): boolean {
  return sport === 'run' || sport === 'walk';
}

/** Per-point smoothed ground speed (m/s), index-aligned to the track. */
export function speedSeries(track: TrackPoint[]): number[] {
  const raw: (number | null)[] = track.map((p, i) => {
    if (i === 0) return null;
    const prev = track[i - 1];
    const d = haversine(prev.lat, prev.lng, p.lat, p.lng);
    const dt = (p.t - prev.t) / 1000;
    // Prefer device speed when GPS distance is ~0 (treadmill / tunnels).
    if (d < 0.3 && p.speed != null) return p.speed;
    return dt > 0 ? d / dt : 0;
  });
  raw[0] = raw[1] ?? 0;
  return smooth(raw, 5).map((v) => v ?? 0);
}

/** Instantaneous pace (sec/km); null where stopped. Powers the pace chart. */
export function paceSeries(track: TrackPoint[]): (number | null)[] {
  return speedSeries(track).map((s) =>
    s >= MOVING_SPEED_THRESHOLD_MS ? 1000 / s : null,
  );
}

/** Classify a foot/wheel segment by smoothed speed. */
function classify(speed: number, sport: Sport): Sport | 'rest' {
  if (speed < MOVING_SPEED_THRESHOLD_MS) return 'rest';
  if (sport === 'ride') return 'ride';
  return speed >= RUN_SPEED_THRESHOLD_MS ? 'run' : 'walk';
}

/**
 * Segment the track into laps by sustained effort class (run / walk / rest),
 * merging bursts shorter than MIN_LAP_SEC into their neighbour. Returns [] when
 * there's no real interval structure (single class throughout). This is the
 * fallback when the platform doesn't hand us explicit laps.
 */
function deriveLaps(track: TrackPoint[], sport: Sport, speeds: number[]): Lap[] {
  const MIN_LAP_SEC = 20;
  type Grp = { cls: Sport | 'rest'; from: number; to: number };
  const groups: Grp[] = [];
  for (let i = 1; i < track.length; i++) {
    const cls = classify(speeds[i], sport);
    const last = groups[groups.length - 1];
    if (last && last.cls === cls) last.to = i;
    else groups.push({ cls, from: i - 1, to: i });
  }
  // Merge too-short groups into the previous one (or the next for the first).
  const merged: Grp[] = [];
  for (const g of groups) {
    const durSec = (track[g.to].t - track[g.from].t) / 1000;
    if (durSec < MIN_LAP_SEC && merged.length) {
      merged[merged.length - 1].to = g.to;
    } else if (durSec < MIN_LAP_SEC && groups.length > 1) {
      // first, too short — fold forward by leaving it; will be absorbed below
      merged.push(g);
    } else {
      merged.push(g);
    }
  }
  const distinct = new Set(merged.map((g) => g.cls));
  if (merged.length < 2 || distinct.size < 2) return [];

  return merged.map((g, index) => {
    let dist = 0;
    const hrs: number[] = [];
    for (let i = g.from + 1; i <= g.to; i++) {
      const prev = track[i - 1];
      const cur = track[i];
      dist += haversine(prev.lat, prev.lng, cur.lat, cur.lng);
      if (cur.hr != null) hrs.push(cur.hr);
    }
    const durationSec = (track[g.to].t - track[g.from].t) / 1000;
    const km = dist / 1000;
    return {
      index,
      type: g.cls,
      startMs: track[g.from].t,
      endMs: track[g.to].t,
      distanceM: dist,
      durationSec,
      avgPaceSecPerKm: km > 0 && g.cls !== 'rest' ? durationSec / km : null,
      avgHr: avg(hrs),
    };
  });
}

/** Longest single moving stretch (meters) without dropping to a rest. */
function longestContinuous(
  track: TrackPoint[],
  sport: Sport,
  speeds: number[],
): number {
  const runClass = sport === 'ride' ? 'ride' : sport === 'walk' ? 'walk' : 'run';
  let best = 0;
  let cur = 0;
  for (let i = 1; i < track.length; i++) {
    const cls = classify(speeds[i], sport);
    // Count a stretch as "continuous" only while at the sport's own effort level
    // (a run goal shouldn't count walk breaks).
    if (cls === runClass) {
      const prev = track[i - 1];
      cur += haversine(prev.lat, prev.lng, track[i].lat, track[i].lng);
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

/** MET-based calorie estimate when the platform gives none. */
function estimateCalories(
  sport: Sport,
  distanceM: number,
  durationSec: number,
  weightKg: number | null | undefined,
): number | null {
  if (durationSec <= 0 || distanceM <= 0) return null;
  const w = weightKg && weightKg > 0 ? weightKg : 70;
  const speedMmin = distanceM / (durationSec / 60);
  let met: number;
  if (sport === 'ride') {
    const kmh = distanceM / 1000 / (durationSec / 3600);
    met = Math.max(3, kmh * 0.45);
  } else if (sport === 'walk') {
    met = (0.1 * speedMmin + 3.5) / 3.5;
  } else {
    met = (0.2 * speedMmin + 3.5) / 3.5;
  }
  return Math.round(met * w * (durationSec / 3600));
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
    avgCadence: null,
    maxCadence: null,
    avgPower: null,
    maxPower: null,
    totalSteps: null,
    vo2Max: null,
    gradeAdjustedPaceSecPerKm: null,
    hrZones: null,
    bestEfforts: [],
    bounds: null,
    laps: [],
    longestContinuousM: 0,
    trainingLoad: null,
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
  let flatEquivM = 0; // grade-adjusted equivalent distance (run/walk)

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

  // cadence & power accumulators
  const cadValues: number[] = [];
  let maxCad = 0;
  const powerValues: number[] = [];
  let maxPow = 0;

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

    // grade-adjusted equivalent distance (run/walk only, on moving segments)
    if (usesPace(sport) && moving && segDist > 0) {
      const prevA = smoothAlt[i - 1];
      const grade = prevA != null && a != null ? (a - prevA) / segDist : 0;
      flatEquivM += segDist * gradeCostFactor(grade);
    }

    // HR zone time
    if (hrZones && cur.hr != null && moving) {
      hrZones[hrZoneIndex(cur.hr, opts.maxHr!)] += segMs / 1000;
    }
    if (cur.hr != null) splitHr.push(cur.hr);

    // Cadence accumulation
    if (cur.cad != null && cur.cad > 0) {
      cadValues.push(cur.cad);
      if (cur.cad > maxCad) maxCad = cur.cad;
    }

    // Power accumulation (ride only)
    if (cur.power != null && cur.power > 0) {
      powerValues.push(cur.power);
      if (cur.power > maxPow) maxPow = cur.power;
    }

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

  // Partial final split (the leftover <1 km after the last full km).
  const remainderM = distanceM - splitStartDist;
  if (remainderM > 50) {
    const lastT = track[track.length - 1].t;
    const durationSec = (lastT - splitStartMs) / 1000;
    const lastAlt = smoothAlt[track.length - 1];
    splits.push({
      index: splits.length,
      distanceM: remainderM,
      durationSec,
      paceSecPerKm: durationSec / (remainderM / 1000),
      elevChangeM: lastAlt != null && splitStartAlt != null ? lastAlt - splitStartAlt : 0,
      avgHr: avg(splitHr),
      partial: true,
    });
  }

  const durationElapsedSec = (track[track.length - 1].t - track[0].t) / 1000;
  const durationMovingSec = movingMs / 1000;
  const distanceKm = distanceM / 1000;

  // Interval/effort analysis from a smoothed speed series.
  const speeds = speedSeries(track);
  const laps = deriveLaps(track, sport, speeds);
  const longestContinuousM = longestContinuous(track, sport, speeds);

  // Training load: zone-weighted minutes (needs HR zones from a max-HR).
  const trainingLoad = hrZones
    ? Math.round(
        hrZones.reduce((acc, secs, i) => acc + (secs / 60) * (i + 1), 0),
      )
    : null;

  const hrValues = track.map((p) => p.hr).filter((v): v is number => v != null);

  // Compute cadence aggregates
  const avgCadence = avg(cadValues);
  const computedMaxCad = cadValues.length > 0 ? maxCad : null;

  // Compute power aggregates (ride)
  const avgPower = sport === 'ride' ? avg(powerValues) : null;
  const computedMaxPow = sport === 'ride' && powerValues.length > 0 ? maxPow : null;

  // Estimate total steps from cadence × duration for run/walk
  let totalSteps: number | null = null;
  if (usesPace(sport) && avgCadence != null && durationMovingSec > 0) {
    totalSteps = Math.round(avgCadence * (durationMovingSec / 60));
  }

  return {
    durationMovingSec,
    durationElapsedSec,
    distanceM,
    avgPaceSecPerKm:
      usesPace(sport) && distanceKm > 0 ? durationMovingSec / distanceKm : null,
    avgSpeedKmh:
      sport === 'ride' && durationMovingSec > 0
        ? distanceKm / (durationMovingSec / 3600)
        : null,
    elevGainM,
    elevLossM,
    avgHr: avg(hrValues),
    maxHr: hrValues.length ? Math.max(...hrValues) : null,
    calories: estimateCalories(sport, distanceM, durationMovingSec, opts.weightKg),
    splits,
    maxSpeedKmh: maxSpeedMs * 3.6,
    avgCadence,
    maxCadence: computedMaxCad,
    avgPower,
    maxPower: computedMaxPow,
    totalSteps,
    vo2Max: null, // only populated from Samsung Health session data
    gradeAdjustedPaceSecPerKm:
      usesPace(sport) && flatEquivM > 0
        ? durationMovingSec / (flatEquivM / 1000)
        : null,
    hrZones,
    bestEfforts: computeBestEfforts(cumDist, cumTime, distanceM),
    bounds: computeBounds(track),
    laps,
    longestContinuousM,
    trainingLoad,
    routePreview: routePreview(track),
  };
}
