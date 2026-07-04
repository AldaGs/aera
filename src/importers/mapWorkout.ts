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
  meanHeartRate?: number; // bpm, session-level
  maxHeartRate?: number;  // bpm, session-level
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

  // The platform's session summary (distance/duration/HR) comes from the watch's
  // fused sensors and stays correct even when the embedded GPS route is missing
  // or PARTIAL (GPS dropout mid-run). Trust it whenever it materially exceeds what
  // the track alone yields — otherwise a dropped-GPS run under-reports badly (e.g.
  // a 2.75 km watch run shows as the 0.36 km that GPS happened to capture). The
  // track is still kept for the route shape, splits, elevation, zones and charts.
  const noTrack = track.length < 2;
  if (hw.distance && hw.distance > 0 && (noTrack || hw.distance > summary.distanceM * 1.05)) {
    summary.distanceM = hw.distance;
  }
  if (hw.duration > 0 && (noTrack || hw.duration > summary.durationElapsedSec * 1.05)) {
    summary.durationMovingSec = hw.duration;
    summary.durationElapsedSec = hw.duration;
  }
  // Recompute pace/speed from the (possibly platform-corrected) distance + time.
  if (summary.distanceM > 0 && summary.durationMovingSec > 0) {
    const km = summary.distanceM / 1000;
    if (sport === 'run' || sport === 'walk') {
      summary.avgPaceSecPerKm = summary.durationMovingSec / km;
      summary.avgSpeedKmh = null;
    } else {
      summary.avgSpeedKmh = km / (summary.durationMovingSec / 3600);
      summary.avgPaceSecPerKm = null;
    }
  }
  if (hw.calories > 0) summary.calories = Math.round(hw.calories);

  // Pass through session-level metrics from Samsung Health when available. These
  // cover the whole session, so they beat track-derived aggregates on a partial
  // route (where HR/cadence would otherwise reflect only the GPS fragment).
  if (hw.meanHeartRate && hw.meanHeartRate > 0) summary.avgHr = Math.round(hw.meanHeartRate);
  if (hw.maxHeartRate && hw.maxHeartRate > 0) summary.maxHr = Math.round(hw.maxHeartRate);
  if (hw.meanCadence && hw.meanCadence > 0) summary.avgCadence = hw.meanCadence;
  if (hw.maxCadence && hw.maxCadence > 0) summary.maxCadence = hw.maxCadence;
  if (hw.vo2Max && hw.vo2Max > 0) summary.vo2Max = hw.vo2Max;
  // Re-estimate steps from the corrected duration when cadence is known.
  if ((sport === 'run' || sport === 'walk') && summary.avgCadence != null && summary.durationMovingSec > 0) {
    summary.totalSteps = Math.round(summary.avgCadence * (summary.durationMovingSec / 60));
  }

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
