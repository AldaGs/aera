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
  /** HR zone boundaries (bpm, 4 values); overrides the % of maxHr bands. */
  zoneBounds?: number[] | null;
  /** Session clock from the recorder: wall time start→finish and moving time
   * (elapsed minus manual/auto pauses). Overrides the track-derived values. */
  timeline?: { elapsedSec: number; movingSec: number } | null;
}

/** A fix-to-fix gap longer than this is a GPS gap: no distance is drawn across it. */
export const GPS_GAP_MS = 15000;
/** Laps/splits shorter than this have no meaningful pace. */
export const MIN_PACE_DISTANCE_M = 50;
/** Laps shorter than this are artefacts (e.g. a stop tap right after a lap tap). */
export const MIN_LAP_SEC = 2;

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

/** Fastest plausible speed per sport (m/s); anything faster is a GPS teleport. */
export const MAX_SPEED_MS: Record<Sport, number> = { run: 12, walk: 5, ride: 25 };

/**
 * 0-based HR zone. Pass explicit bpm boundaries (Z1 < b[0] ≤ Z2 < … ≤ Z5), or a
 * max HR for the default % bands: Z1<60, Z2<70, Z3<80, Z4<90, Z5≥90.
 */
export function hrZoneIndex(hr: number, maxHrOrBounds: number | readonly number[]): number {
  if (typeof maxHrOrBounds !== 'number') {
    const i = maxHrOrBounds.findIndex((b) => hr < b);
    return i < 0 ? 4 : i;
  }
  const pct = hr / maxHrOrBounds;
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

/**
 * Distance between two consecutive track points. Uses GPS great-circle distance,
 * but falls back to the watch's per-sample speed when GPS is stalled/carried
 * forward (great-circle ~0 while the athlete is actually moving).
 */
export function segmentDistance(prev: TrackPoint, cur: TrackPoint): number {
  const gps = haversine(prev.lat, prev.lng, cur.lat, cur.lng);
  const dt = (cur.t - prev.t) / 1000;
  const speedDist = cur.speed != null && dt > 0 ? cur.speed * dt : 0;
  return gps < 1 && speedDist > 0 ? speedDist : gps;
}

export interface GpsGap {
  startMs: number;
  endMs: number;
}

/**
 * Distance for each segment (index i = track[i-1] → track[i]), measured
 * fix-to-fix. HR-only points (`noFix`) add nothing; a jump across a time gap
 * longer than GPS_GAP_MS (screen-off, signal loss, skipped warm-up GPS) or
 * faster than the sport allows counts as zero instead of a straight line.
 */
export function segmentDistances(
  track: TrackPoint[],
  sport: Sport,
): { dist: number[]; gaps: GpsGap[] } {
  const dist = new Array<number>(track.length).fill(0);
  const gaps: GpsGap[] = [];
  let lastFix = -1;
  for (let i = 0; i < track.length; i++) {
    const cur = track[i];
    if (cur.noFix) continue;
    if (lastFix >= 0) {
      const prev = track[lastFix];
      const dtMs = cur.t - prev.t;
      if (dtMs > GPS_GAP_MS) {
        gaps.push({ startMs: prev.t, endMs: cur.t });
      } else {
        const d = segmentDistance(prev, cur);
        if (dtMs > 0 && d / (dtMs / 1000) > MAX_SPEED_MS[sport]) continue; // teleport: keep the old anchor
        dist[i] = d;
      }
    }
    lastFix = i;
  }
  return { dist, gaps };
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
function deriveLaps(track: TrackPoint[], sport: Sport, speeds: number[], segDist: number[]): Lap[] {
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
      const cur = track[i];
      dist += segDist[i];
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
      avgPaceSecPerKm: dist >= MIN_PACE_DISTANCE_M && g.cls !== 'rest' ? durationSec / km : null,
      avgHr: avg(hrs),
    };
  });
}

/** A dip below the sport's effort level shorter than this doesn't break a stretch. */
const CONTINUOUS_DIP_TOLERANCE_MS = 10000;

/**
 * Longest stretch (meters) at the sport's own effort level (a run goal doesn't
 * count walk breaks). Short dips — a smoothed-speed wobble, a corner, a few
 * stalled fixes — are bridged; a sustained slowdown or a GPS gap ends it.
 */
function longestContinuous(
  track: TrackPoint[],
  sport: Sport,
  speeds: number[],
  segDist: number[],
  gaps: GpsGap[],
): number {
  const runClass = sport === 'ride' ? 'ride' : sport === 'walk' ? 'walk' : 'run';
  const inGap = (t: number) => gaps.some((g) => t > g.startMs && t <= g.endMs);
  let best = 0;
  let cur = 0;
  let pending = 0; // distance covered during the current dip, credited if it ends soon
  let lastOnMs: number | null = null;
  for (let i = 1; i < track.length; i++) {
    const t = track[i].t;
    if (inGap(t)) {
      cur = 0;
      pending = 0;
      lastOnMs = null;
      continue;
    }
    if (classify(speeds[i], sport) === runClass) {
      if (lastOnMs == null) cur = 0;
      cur += pending + segDist[i];
      pending = 0;
      lastOnMs = t;
      if (cur > best) best = cur;
    } else if (lastOnMs != null && t - lastOnMs <= CONTINUOUS_DIP_TOLERANCE_MS) {
      pending += segDist[i];
    } else {
      cur = 0;
      pending = 0;
      lastOnMs = null;
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
 * Per-km splits over the segments `include` accepts (all by default). Excluded
 * segments neither add distance nor time — e.g. splits over the run laps only,
 * skipping the warm-up and walk.
 */
export function computeSplits(
  track: TrackPoint[],
  segDist: number[],
  include: (i: number) => boolean = () => true,
): Split[] {
  const smoothAlt = smooth(
    track.map((p) => p.alt),
    9,
  );
  const splits: Split[] = [];
  let dist = 0;
  let splitStartDist = 0;
  let splitSec = 0;
  let splitStartAlt: number | null = null;
  let lastAlt: number | null = null;
  const splitHr: number[] = [];
  for (let i = 1; i < track.length; i++) {
    if (!include(i)) continue;
    const cur = track[i];
    const a = smoothAlt[i];
    if (splitStartAlt == null) splitStartAlt = smoothAlt[i - 1] ?? a;
    dist += segDist[i];
    splitSec += (cur.t - track[i - 1].t) / 1000;
    if (cur.hr != null) splitHr.push(cur.hr);
    if (a != null) lastAlt = a;
    while (dist - splitStartDist >= 1000) {
      splits.push({
        index: splits.length,
        distanceM: 1000,
        durationSec: splitSec,
        paceSecPerKm: splitSec,
        elevChangeM: a != null && splitStartAlt != null ? a - splitStartAlt : 0,
        avgHr: avg(splitHr),
      });
      splitStartDist += 1000;
      splitSec = 0;
      splitStartAlt = a;
      splitHr.length = 0;
    }
  }
  // Partial final split (the leftover <1 km after the last full km).
  const remainderM = dist - splitStartDist;
  if (remainderM > MIN_PACE_DISTANCE_M) {
    splits.push({
      index: splits.length,
      distanceM: remainderM,
      durationSec: splitSec,
      paceSecPerKm: splitSec / (remainderM / 1000),
      elevChangeM: lastAlt != null && splitStartAlt != null ? lastAlt - splitStartAlt : 0,
      avgHr: avg(splitHr),
      partial: true,
    });
  }
  return splits;
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
    durationMovingSec: opts.timeline?.movingSec ?? 0,
    durationElapsedSec: opts.timeline?.elapsedSec ?? 0,
    distanceM: 0,
    avgPaceSecPerKm: null,
    runAvgPaceSecPerKm: null,
    avgSpeedKmh: null,
    elevGainM: 0,
    elevLossM: 0,
    avgHr: null,
    maxHr: null,
    calories: null,
    splits: [],
    splitsScope: 'session',
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
    gpsGaps: [],
    routePreview: [],
  };
  if (track.length < 2) return empty;

  // Smooth the altitude series once, up front — used for both elevation totals
  // and grade-adjusted pace so hills are measured consistently.
  const smoothAlt = smooth(
    track.map((p) => p.alt),
    9,
  );
  // Fix-to-fix distances with GPS gaps and teleports zeroed (see segmentDistances).
  const { dist: segDist, gaps: gpsGaps } = segmentDistances(track, sport);

  let distanceM = 0;
  let movedSegs = 0; // segments with a real GPS displacement (not carried-forward)
  let speedPts = 0; // points carrying a per-sample speed
  let fixSegs = 0; // segments ending on a real GPS fix
  let movingMs = 0;
  let elevGainM = 0;
  let elevLossM = 0;
  let maxSpeedMs = 0;
  let flatEquivM = 0; // grade-adjusted equivalent distance (run/walk)

  const zoneBounds =
    opts.zoneBounds && opts.zoneBounds.length === 4
      ? opts.zoneBounds
      : opts.maxHr != null && opts.maxHr > 0
        ? opts.maxHr
        : null;
  const hasHr = track.some((p) => p.hr != null && p.hr > 0);
  const hrZones = zoneBounds != null && hasHr ? [0, 0, 0, 0, 0] : null;

  // cumulative arrays for best-effort scanning
  const cumDist: number[] = [0];
  const cumTime: number[] = [0];

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
    const segMs = cur.t - prev.t;
    const segD = segDist[i];
    if (!cur.noFix) fixSegs++;
    if (!cur.noFix && haversine(prev.lat, prev.lng, cur.lat, cur.lng) > 0.5) movedSegs++;
    if (cur.speed != null) speedPts++;
    const segSpeed = segMs > 0 ? segD / (segMs / 1000) : 0;

    distanceM += segD;
    cumDist.push(distanceM);
    cumTime.push(cur.t / 1000);

    const moving = segSpeed >= MOVING_SPEED_THRESHOLD_MS;
    if (moving) movingMs += segMs;
    if (segSpeed > maxSpeedMs) maxSpeedMs = segSpeed; // teleports already zeroed

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
    if (usesPace(sport) && moving && segD > 0) {
      const prevA = smoothAlt[i - 1];
      const grade = prevA != null && a != null ? (a - prevA) / segD : 0;
      flatEquivM += segD * gradeCostFactor(grade);
    }

    // HR zone time — the whole session, including warm-up and rests, so the
    // zone total adds up to the time HR was actually recorded.
    if (hrZones && cur.hr != null && cur.hr > 0 && segMs <= GPS_GAP_MS) {
      hrZones[hrZoneIndex(cur.hr, zoneBounds!)] += segMs / 1000;
    }

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
  }

  const splits = computeSplits(track, segDist);

  // Track `t` is an offset from the workout start, so the last point's t is the
  // elapsed time (not last − first: a late first fix would drop the warm-up).
  // A recorder-supplied session clock wins; moving can never exceed elapsed.
  const trackElapsedSec = track[track.length - 1].t / 1000;
  const durationElapsedSec = Math.max(opts.timeline?.elapsedSec ?? trackElapsedSec, 0);
  const durationMovingSec = Math.min(opts.timeline?.movingSec ?? movingMs / 1000, durationElapsedSec);
  const distanceKm = distanceM / 1000;

  // Interval/effort analysis from a smoothed speed series. Only derive laps when
  // we actually have the signal to segment reliably — good per-sample speed
  // coverage OR near-complete GPS. Otherwise (e.g. a partial-GPS run whose log
  // carries no speed) we leave laps empty rather than emit a misleading table;
  // platform-provided laps still override this in the mapper.
  const speeds = speedSeries(track);
  const speedCoverage = fixSegs > 0 ? speedPts / fixSegs : 0;
  const gpsCoverage = fixSegs > 0 ? movedSegs / fixSegs : 0;
  const canDeriveLaps = speedCoverage > 0.6 || gpsCoverage > 0.7;
  const laps = canDeriveLaps ? deriveLaps(track, sport, speeds, segDist) : [];
  const longestContinuousM = longestContinuous(track, sport, speeds, segDist, gpsGaps);

  // Training load: zone-weighted minutes (needs HR zones).
  const trainingLoad = hrZones
    ? Math.round(
        hrZones.reduce((acc, secs, i) => acc + (secs / 60) * (i + 1), 0),
      )
    : null;

  const hrValues = track.map((p) => p.hr).filter((v): v is number => v != null && v > 0);

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

  const fixes = track.filter((p) => !p.noFix);
  return {
    durationMovingSec,
    durationElapsedSec,
    distanceM,
    avgPaceSecPerKm:
      usesPace(sport) && distanceM >= MIN_PACE_DISTANCE_M ? durationMovingSec / distanceKm : null,
    runAvgPaceSecPerKm: null, // set when typed run laps exist (see applyLapScopes)
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
    splitsScope: 'session',
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
    bounds: computeBounds(fixes),
    laps,
    longestContinuousM,
    trainingLoad,
    gpsGaps,
    routePreview: routePreview(fixes),
  };
}

/** Lap types that make up the "run" part of a session (vs warm-up/walk/rest). */
const EFFORT_LAP_TYPES = new Set<Lap['type']>(['run', 'ride']);

/**
 * Once typed laps are known (planned intervals), scope splits and pace to the
 * run segment: per-km splits skip the warm-up/walk/rest laps, `runAvgPace`
 * covers run laps only, and the longest stretch is at least the longest run lap.
 * No-op when there are no run laps or the session is all one effort.
 */
export function applyLapScopes(s: WorkoutSummary, track: TrackPoint[], sport: Sport): void {
  const runLaps = s.laps.filter((l) => EFFORT_LAP_TYPES.has(l.type));
  if (runLaps.length === 0) return;
  const runLapMax = Math.max(...runLaps.map((l) => l.distanceM));
  if (runLapMax > s.longestContinuousM) s.longestContinuousM = runLapMax;
  const runM = runLaps.reduce((a, l) => a + l.distanceM, 0);
  const runSec = runLaps.reduce((a, l) => a + l.durationSec, 0);
  s.runAvgPaceSecPerKm = usesPace(sport) && runM >= MIN_PACE_DISTANCE_M ? runSec / (runM / 1000) : null;
  if (runLaps.length === s.laps.length || !usesPace(sport)) return;
  const { dist } = segmentDistances(track, sport);
  const inRun = (i: number) => {
    const t = track[i].t;
    return runLaps.some((l) => t > l.startMs && t <= l.endMs);
  };
  s.splits = computeSplits(track, dist, inRun);
  s.splitsScope = 'run';
}

/**
 * Clean up laps stored by older builds: warm-up/cool-down laps typed as runs,
 * pace over a few meters, and sub-2 s artefact laps. Idempotent.
 */
export function normalizeLaps(laps: Lap[]): Lap[] {
  return laps
    .filter((l) => l.durationSec >= MIN_LAP_SEC)
    .map((l, index) => {
      const type: Lap['type'] = /warm/i.test(l.label ?? '')
        ? 'warmup'
        : /cool/i.test(l.label ?? '')
          ? 'cooldown'
          : l.type;
      return {
        ...l,
        index,
        type,
        avgPaceSecPerKm: l.distanceM >= MIN_PACE_DISTANCE_M ? l.avgPaceSecPerKm : null,
      };
    });
}

/** Sanity checks on a finished summary; returns human-readable violations. */
export function summaryInvariantViolations(s: WorkoutSummary): string[] {
  const out: string[] = [];
  if (s.durationMovingSec > s.durationElapsedSec + 1)
    out.push(`moving ${s.durationMovingSec.toFixed(1)} s > elapsed ${s.durationElapsedSec.toFixed(1)} s`);
  if (s.laps.length > 0) {
    // Lap bounds live on the recorder's (moving) clock, so they should cover it.
    const lapSec = s.laps.reduce((a, l) => a + l.durationSec, 0);
    const endSec = s.laps[s.laps.length - 1].endMs / 1000;
    const span = endSec - s.laps[0].startMs / 1000;
    if (Math.abs(lapSec - span) > 2)
      out.push(`lap durations sum to ${lapSec.toFixed(1)} s but laps span ${span.toFixed(1)} s`);
    if (endSec > s.durationElapsedSec + 2)
      out.push(`laps run to ${endSec.toFixed(1)} s, past elapsed ${s.durationElapsedSec.toFixed(1)} s`);
  }
  return out;
}
