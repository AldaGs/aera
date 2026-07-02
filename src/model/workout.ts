// The normalized Workout contract. Every screen, stat, and share image reads from
// this shape only. Platform health data (Health Connect / HealthKit) is mapped into
// it by importers and is never touched directly elsewhere.

export type Sport = 'run' | 'ride';
export type WorkoutSource =
  | 'health-connect'
  | 'samsung-health'
  | 'healthkit'
  | 'manual';

/** One recorded GPS sample (~1/sec). The raw stream is the source of truth. */
export interface TrackPoint {
  t: number; // ms offset from workout start
  lat: number;
  lng: number;
  alt: number | null; // meters
  hr: number | null; // bpm, if watch paired HR
  cad: number | null; // cadence (steps/min run, rpm bike) — optional
}

/** Fastest time to cover a target distance anywhere within the workout. */
export interface BestEffort {
  distanceM: number; // target: 1000, 5000, 10000…
  durationSec: number;
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
  hrZones: number[] | null; // seconds in each of 5 zones [Z1..Z5]; null if no HR/maxHR
  bestEfforts: BestEffort[]; // fastest 1k/5k/10k within this workout
  bounds: LatLngBounds | null;

  // Downsampled [lat, lng] path (~48 pts) for cheap feed/list thumbnails,
  // so list views never load the full raw track.
  routePreview: [number, number][];
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

  // ingestion dedup: stable id from the source platform (Health Connect /
  // HealthKit session id). Null for manually created workouts.
  externalId: string | null;
}
