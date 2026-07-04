// The normalized Workout contract. Every screen, stat, and share image reads from
// this shape only. Platform health data (Health Connect / HealthKit) is mapped into
// it by importers and is never touched directly elsewhere.

export type Sport = 'run' | 'ride' | 'walk';
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
  cad: number | null; // cadence (steps/min run/walk, rpm bike) — optional
  speed: number | null; // m/s — from ExerciseLog.speed
  power: number | null; // watts — cycling, from ExerciseLog.power
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
  partial?: boolean; // final split shorter than 1 km
}

/**
 * One lap/segment of an interval workout (e.g. warmup, then walk/run repeats).
 * Sourced from the platform's lap data when available, else derived from the
 * track by segmenting on sustained pace changes.
 */
export interface Lap {
  index: number;
  type: Sport | 'rest'; // 'rest' = recovery walk/stand between efforts
  startMs: number; // ms offset from workout start
  endMs: number;
  distanceM: number;
  durationSec: number;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  label?: string; // e.g. "Warm-up", "Work 3/5" — set for planned interval laps
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

  // Cadence & power aggregates
  avgCadence: number | null;   // steps/min (run/walk) or RPM (ride)
  maxCadence: number | null;
  avgPower: number | null;     // watts (ride)
  maxPower: number | null;
  totalSteps: number | null;   // walk/run — estimated from cadence × duration
  vo2Max: number | null;       // from Samsung Health, session-level

  // Strava-flavored extras:
  gradeAdjustedPaceSecPerKm: number | null; // run — pace normalized for hills
  hrZones: number[] | null; // seconds in each of 5 zones [Z1..Z5]; null if no HR/maxHR
  bestEfforts: BestEffort[]; // fastest 1k/5k/10k within this workout
  bounds: LatLngBounds | null;

  // Interval/lap breakdown (warmup + walk/run repeats). Empty when the workout
  // has no lap structure.
  laps: Lap[];
  // Longest single uninterrupted "moving" run/walk segment, meters — powers the
  // "run 1 continuous km" style goals.
  longestContinuousM: number;
  // Training load (TRIMP-style) for this session; null without HR + maxHR.
  trainingLoad: number | null;

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
