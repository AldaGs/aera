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
}

/** Stable dedup key: the platform session id, or a start/end fallback. */
export function externalKey(hw: HealthWorkout): string {
  return hw.id ?? `${hw.startDate}_${hw.endDate}`;
}

/**
 * Map a platform exercise type to our sports; null = unsupported.
 * Foot-based activities (run/walk/hike) bucket to 'run'; wheeled to 'ride'.
 * Health Connect also reports numeric exercise-type codes as strings, so we
 * match the common ones by number too.
 */
export function mapSport(workoutType: string): Sport | null {
  const t = String(workoutType).toUpperCase();
  if (t.includes('RUN') || t.includes('WALK') || t.includes('HIK')) return 'run';
  if (t.includes('BIK') || t.includes('CYCL')) return 'ride';
  // Health Connect numeric EXERCISE_TYPE codes (when passed through as-is):
  // 56=RUNNING, 57=RUNNING_TREADMILL, 79=WALKING, 73=HIKING,
  // 8=BIKING, 9=BIKING_STATIONARY.
  if (['56', '57', '79', '73'].includes(t)) return 'run';
  if (['8', '9'].includes(t)) return 'ride';
  return null;
}

/** Attach HR samples to route points by nearest timestamp (both sorted, two-pointer). */
function buildTrack(
  route: HealthRouteSample[],
  hr: HealthHrSample[],
  startMs: number,
): TrackPoint[] {
  const hrSorted = [...hr].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  );
  let j = 0;
  return route
    .map((r) => {
      const t = Date.parse(r.timestamp);
      // advance j to the hr sample nearest t
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
        // only attach HR if within 15s of this point
        hr: near && Math.abs(nearMs - t) <= 15000 ? near.bpm : null,
        cad: null,
      };
    })
    .sort((a, b) => a.t - b.t);
}

export interface MapOptions {
  athleteId?: string;
  maxHr?: number | null;
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
  const track = buildTrack(hw.route ?? [], hw.heartRate ?? [], startMs);

  const summary = deriveSummary(track, sport, { maxHr: opts.maxHr });

  // The platform's own distance/calories are authoritative when we lack a track
  // to derive them from (e.g. treadmill runs with no GPS route).
  if (track.length < 2 && hw.distance && hw.distance > 0) summary.distanceM = hw.distance;
  if (hw.calories > 0) summary.calories = Math.round(hw.calories);

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const title =
    sport === 'run'
      ? partOfDay(startMs) + ' Run'
      : partOfDay(startMs) + ' Ride';

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
