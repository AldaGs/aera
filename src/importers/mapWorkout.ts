import type { Sport, TrackPoint, Workout } from '@/model/workout';
import { deriveSummary } from '@/metrics/deriveSummary';

// Shape returned by capacitor-health's queryWorkouts(). Mirrored here so the
// mapper is pure and unit-testable without importing the native plugin.
export interface HealthRouteSample {
  timestamp: string;
  lat: number;
  lng: number;
  alt?: number;
}
export interface HealthHrSample {
  timestamp: string;
  bpm: number;
}
/** Combined per-sample log entry from the Samsung Health ExerciseLog. */
export interface HealthLogSample {
  timestamp: string;
  bpm?: number;
  speed?: number;   // m/s
  cadence?: number;  // spm (run/walk) or rpm (ride)
  power?: number;    // watts (ride)
}
/** One lap/segment from the platform's interval data. */
export interface HealthLap {
  startDate: string;
  endDate: string;
  type?: string;      // exercise-type name, if the platform tags the lap
  distance?: number;  // meters
  duration?: number;  // seconds
}
export interface HealthWorkout {
  id?: string;
  startDate: string;
  endDate: string;
  workoutType: string;
  sourceName?: string;
  duration: number; // seconds
  distance?: number; // meters
  calories: number;
  route?: HealthRouteSample[];
  heartRate?: HealthHrSample[];
  /** Combined log with HR + speed + cadence + power (Samsung Health SDK). */
  log?: HealthLogSample[];
  // Session-level summary from Samsung Health
  meanCadence?: number;
  maxCadence?: number;
  meanSpeed?: number;  // m/s
  maxSpeed?: number;   // m/s
  vo2Max?: number;
  laps?: HealthLap[];
}

/** Stable dedup key: the platform session id, or a start/end fallback. */
export function externalKey(hw: HealthWorkout): string {
  return hw.id ?? `${hw.startDate}_${hw.endDate}`;
}

/**
 * Map a platform exercise type to our sports; null = unsupported.
 * Foot-based activities: run → 'run', walk/hike → 'walk'; wheeled → 'ride'.
 * Health Connect also reports numeric exercise-type codes as strings, so we
 * match the common ones by number too.
 */
export function mapSport(workoutType: string): Sport | null {
  const t = String(workoutType).toUpperCase();
  if (t.includes('RUN')) return 'run';
  if (t.includes('WALK') || t.includes('HIK')) return 'walk';
  if (t.includes('BIK') || t.includes('CYCL')) return 'ride';
  // Health Connect numeric EXERCISE_TYPE codes (when passed through as-is):
  // 56=RUNNING, 57=RUNNING_TREADMILL, 79=WALKING, 73=HIKING,
  // 8=BIKING, 9=BIKING_STATIONARY.
  if (['56', '57'].includes(t)) return 'run';
  if (['79', '73'].includes(t)) return 'walk';
  if (['8', '9'].includes(t)) return 'ride';
  return null;
}

/**
 * Attach HR/speed/cadence/power samples to route points by nearest timestamp
 * (both sorted, two-pointer). Prefers the combined `log` array; falls back to
 * the legacy `heartRate` array.
 */
function buildTrack(
  route: HealthRouteSample[],
  hr: HealthHrSample[],
  log: HealthLogSample[],
  startMs: number,
): TrackPoint[] {
  // Use combined log if available, otherwise fall back to legacy HR samples
  const useCombinedLog = log.length > 0;
  const logSorted = useCombinedLog
    ? [...log].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    : [];
  const hrSorted = !useCombinedLog
    ? [...hr].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    : [];

  let j = 0;
  return route
    .map((r) => {
      const t = Date.parse(r.timestamp);

      if (useCombinedLog) {
        // advance j to the log sample nearest t
        while (
          j < logSorted.length - 1 &&
          Math.abs(Date.parse(logSorted[j + 1].timestamp) - t) <=
            Math.abs(Date.parse(logSorted[j].timestamp) - t)
        ) {
          j++;
        }
        const near = logSorted[j];
        const nearMs = near ? Date.parse(near.timestamp) : Infinity;
        const withinRange = near && Math.abs(nearMs - t) <= 15000;
        return {
          t: t - startMs,
          lat: r.lat,
          lng: r.lng,
          alt: r.alt != null && Number.isFinite(r.alt) ? r.alt : null,
          hr: withinRange && near.bpm != null ? near.bpm : null,
          cad: withinRange && near.cadence != null ? near.cadence : null,
          speed: withinRange && near.speed != null ? near.speed : null,
          power: withinRange && near.power != null ? near.power : null,
        };
      } else {
        // Legacy path: HR-only samples
        while (
          j < hrSorted.length - 1 &&
          Math.abs(Date.parse(hrSorted[j + 1].timestamp) - t) <=
            Math.abs(Date.parse(hrSorted[j].timestamp) - t)
        ) {
          j++;
        }
        const near = hrSorted[j];
        const nearMs = near ? Date.parse(near.timestamp) : Infinity;
        return {
          t: t - startMs,
          lat: r.lat,
          lng: r.lng,
          alt: r.alt != null && Number.isFinite(r.alt) ? r.alt : null,
          hr: near && Math.abs(nearMs - t) <= 15000 ? near.bpm : null,
          cad: null,
          speed: null,
          power: null,
        };
      }
    })
    .sort((a, b) => a.t - b.t);
}

export interface MapOptions {
  athleteId?: string;
  maxHr?: number | null;
  restingHr?: number | null;
  weightKg?: number | null;
}

/** Map platform lap payloads onto our Lap shape (uses start/end vs workout start). */
function mapLaps(
  laps: HealthLap[],
  startMs: number,
  fallbackSport: Sport,
): import('@/model/workout').Lap[] {
  return laps.map((l, index) => {
    const s = Date.parse(l.startDate);
    const e = Date.parse(l.endDate);
    const durationSec = l.duration ?? (e - s) / 1000;
    const distanceM = l.distance ?? 0;
    const km = distanceM / 1000;
    const type = l.type ? mapSport(l.type) ?? 'rest' : fallbackSport;
    return {
      index,
      type,
      startMs: s - startMs,
      endMs: e - startMs,
      distanceM,
      durationSec,
      avgPaceSecPerKm: km > 0 && type !== 'rest' ? durationSec / km : null,
      avgHr: null,
    };
  });
}

/**
 * Convert one health-platform workout into our normalized Workout.
 * Returns null for unsupported sports. Pure: no plugin, no storage, no clock.
 */
export function mapHealthWorkout(
  hw: HealthWorkout,
  opts: MapOptions = {},
): Workout | null {
  const sport = mapSport(hw.workoutType);
  if (!sport) return null;

  const startMs = Date.parse(hw.startDate);
  const track = buildTrack(hw.route ?? [], hw.heartRate ?? [], hw.log ?? [], startMs);

  const summary = deriveSummary(track, sport, {
    maxHr: opts.maxHr,
    restingHr: opts.restingHr,
    weightKg: opts.weightKg,
  });

  // Platform-provided laps win over the track-derived fallback.
  if (hw.laps && hw.laps.length > 0) {
    summary.laps = mapLaps(hw.laps, startMs, sport);
  }

  // The platform's own summary is authoritative when we lack a track to derive
  // from (e.g. treadmill runs, or Samsung sessions that arrive without a route).
  if (track.length < 2) {
    if (hw.distance && hw.distance > 0) summary.distanceM = hw.distance;
    if (hw.duration > 0) {
      summary.durationMovingSec = hw.duration;
      summary.durationElapsedSec = hw.duration;
    }
    // Recompute pace/speed from the platform distance + duration so the card
    // doesn't show "—" when there's no track to derive them from.
    if (summary.distanceM > 0 && summary.durationMovingSec > 0) {
      const km = summary.distanceM / 1000;
      if (sport === 'run' || sport === 'walk') {
        summary.avgPaceSecPerKm = summary.durationMovingSec / km;
      } else {
        summary.avgSpeedKmh = km / (summary.durationMovingSec / 3600);
      }
    }
  }
  if (hw.calories > 0) summary.calories = Math.round(hw.calories);

  // Pass through session-level metrics from Samsung Health when available
  if (hw.meanCadence && hw.meanCadence > 0) summary.avgCadence = hw.meanCadence;
  if (hw.maxCadence && hw.maxCadence > 0) summary.maxCadence = hw.maxCadence;
  if (hw.vo2Max && hw.vo2Max > 0) summary.vo2Max = hw.vo2Max;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sportLabel = sport === 'run' ? 'Run' : sport === 'walk' ? 'Walk' : 'Ride';
  const title = partOfDay(startMs) + ' ' + sportLabel;

  return {
    id: crypto.randomUUID(),
    sport,
    source: 'health-connect',
    startedAt: new Date(startMs).toISOString(),
    timezone,
    track,
    summary,
    title,
    notes: '',
    athleteId: opts.athleteId ?? 'me',
    externalId: externalKey(hw),
  };
}

function partOfDay(ms: number): string {
  const h = new Date(ms).getHours();
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Night';
}
