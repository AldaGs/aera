// The normalized Workout contract. Every screen, stat, and share image reads from
// this shape only. Platform health data (Health Connect / HealthKit) is mapped into
// it by importers and is never touched directly elsewhere.

export type Sport = 'run' | 'ride';
export type WorkoutSource = 'health-connect' | 'healthkit' | 'manual';

/** One recorded GPS sample (~1/sec). The raw stream is the source of truth. */
export interface TrackPoint {
  t: number; // ms offset from workout start
  lat: number;
  lng: number;
  alt: number | null; // meters
  hr: number | null; // bpm, if watch paired HR
  cad: number | null; // cadence (steps/min run, rpm bike) — optional
}

export interface Split {
  index: number;
  distanceM: number;
  durationSec: number;
  paceSecPerKm: number | null;
  elevChangeM: number;
  avgHr: number | null;
}

export interface LatLngBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** All fields DERIVED from `track` via deriveSummary(), cached for fast list views. */
export interface WorkoutSummary {
  durationMovingSec: number; // excludes auto-pause
  durationElapsedSec: number;
  distanceM: number;
  avgPaceSecPerKm: number | null; // run
  avgSpeedKmh: number | null; // ride
  elevGainM: number;
  elevLossM: number;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  splits: Split[];
  maxSpeedKmh: number | null;

  // Strava-flavored extras:
  gradeAdjustedPaceSecPerKm: number | null; // run — pace normalized for hills
  bounds: LatLngBounds | null;
}

export interface Workout {
  id: string; // uuid
  sport: Sport;
  source: WorkoutSource;
  startedAt: string; // ISO, with timezone
  timezone: string;

  track: TrackPoint[]; // raw stream — source of truth

  summary: WorkoutSummary;

  // user layer
  title: string;
  notes: string;
  athleteId: string; // you vs Erika, for the shared-history phase
}
