// The normalized Workout contract. Every screen, stat, and share image reads from
// this shape only. Platform health data (Health Connect / HealthKit) is mapped into
// it by importers and is never touched directly elsewhere.

export type Sport = 'run' | 'ride' | 'walk';
export type WorkoutSource =
  | 'health-connect'
  | 'samsung-health'
  | 'healthkit'
  | 'manual'
  | 'watch';

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
  /** HR-only sample with no GPS fix of its own (warm-up, screen-off gap); lat/lng
   * are carried from the nearest fix and it never adds distance. */
  noFix?: true;
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
export type LapType = Sport | 'rest' | 'warmup' | 'cooldown';

export interface Lap {
  index: number;
  type: LapType; // 'rest' = recovery walk/stand between efforts
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
  avgPaceSecPerKm: number | null; // run — whole session (moving time / distance)
  runAvgPaceSecPerKm: number | null; // run laps only; null without typed run laps
  avgSpeedKmh: number | null; // ride
  elevGainM: number;
  elevLossM: number;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  splits: Split[];
  /** 'session' = splits over the whole track; 'run' = over run laps only. */
  splitsScope: 'session' | 'run';
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
  // Spans (ms offsets) with no GPS fix for > GPS_GAP_MS; no distance is counted
  // across them.
  gpsGaps: { startMs: number; endMs: number }[];

  // Downsampled [lat, lng] path (~48 pts) for cheap feed/list thumbnails,
  // so list views never load the full raw track.
  routePreview: [number, number][];
}

export interface Correction {
  field: keyof WorkoutSummary;
  value: number;
  reason: string;
  at: string; // ISO time the correction was made
}

/** The intended shape of a session, for intended-vs-actual comparisons. */
export interface WorkoutPlanIntent {
  name: string | null;
  warmupSec: number | null; // total timed warm-up
  walkSec: number | null; // total timed walk/recovery
  targetDistanceM: number | null; // total distance of run/work steps
  hrCeiling: number | null; // bpm the athlete meant to stay under
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
  /** User overrides for known-wrong derived values, kept beside the raw data
   * (e.g. { field: 'distanceM', value: 1500, reason: 'GPS cut a corner' }). */
  corrections?: Correction[];
  /** Perceived effort, 1 (very easy) .. 10 (max); asked when a session ends. */
  rpe?: number | null;
  /** What the session intended, snapshotted from the plan at record time. */
  plan?: WorkoutPlanIntent | null;

  // ingestion dedup: stable id from the source platform (Health Connect /
  // HealthKit session id). Null for manually created workouts.
  externalId: string | null;
}
