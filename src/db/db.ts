import Dexie, { type Table } from 'dexie';
import type { TrackPoint, Workout } from '@/model/workout';
import type { Goal } from '@/model/goal';
import type { IntervalPlan } from '@/model/intervalPlan';
import { deriveSummary } from '@/metrics/deriveSummary';

// Workout metadata + cached summary live in one table for fast list views.
// The large raw track lives in a separate table keyed by workout id, so loading
// the feed never pulls thousands of points per workout.

export type WorkoutMeta = Omit<Workout, 'track'>;

export interface TrackRecord {
  workoutId: string;
  points: TrackPoint[];
}

class AeraDB extends Dexie {
  workouts!: Table<WorkoutMeta, string>;
  tracks!: Table<TrackRecord, string>;
  goals!: Table<Goal, string>;
  plans!: Table<IntervalPlan, string>;

  constructor() {
    super('aera');
    this.version(1).stores({
      // indexes: primary key first, then queryable fields
      workouts: 'id, sport, startedAt, athleteId',
      tracks: 'workoutId',
    });
    // v2 adds externalId for ingestion dedup.
    this.version(2).stores({
      workouts: 'id, sport, startedAt, athleteId, externalId',
      tracks: 'workoutId',
    });
    // v3: model extends TrackPoint (speed, power) + WorkoutSummary (cadence,
    // power, steps, vo2Max). No index changes — the version bump signals the
    // schema evolution; old rows read new fields as undefined.
    this.version(3).stores({
      workouts: 'id, sport, startedAt, athleteId, externalId',
      tracks: 'workoutId',
    });
    // v4: model gains laps/longestContinuousM/trainingLoad on the summary (read
    // as undefined on old rows until re-derived) + a goals table.
    this.version(4).stores({
      workouts: 'id, sport, startedAt, athleteId, externalId',
      tracks: 'workoutId',
      goals: 'id, createdAt, deadline',
    });
    // v5: reusable structured interval-workout templates.
    this.version(5).stores({
      workouts: 'id, sport, startedAt, athleteId, externalId',
      tracks: 'workoutId',
      goals: 'id, createdAt, deadline',
      plans: 'id, createdAt',
    });
  }
}

export const db = new AeraDB();

/** Persist a full workout, splitting the raw track into its own table. */
export async function saveWorkout(workout: Workout): Promise<void> {
  const { track, ...meta } = workout;
  await db.transaction('rw', db.workouts, db.tracks, async () => {
    await db.workouts.put(meta);
    await db.tracks.put({ workoutId: workout.id, points: track });
  });
}

/** Delete a workout and its track. */
export async function deleteWorkout(id: string): Promise<void> {
  await db.transaction('rw', db.workouts, db.tracks, async () => {
    await db.workouts.delete(id);
    await db.tracks.delete(id);
  });
}

/** List workout metadata (no tracks), newest first. */
export async function listWorkouts(): Promise<WorkoutMeta[]> {
  const all = await db.workouts.orderBy('startedAt').toArray();
  return all.reverse();
}

/** Set of externalIds already stored, for import dedup. */
export async function existingExternalIds(): Promise<Set<string>> {
  const ids = await db.workouts
    .where('externalId')
    .notEqual('')
    .toArray();
  return new Set(ids.map((w) => w.externalId).filter((v): v is string => !!v));
}

/**
 * Map of externalId → stored workout meta, for import upgrades. Lets the importer
 * detect a previously-imported summary-only workout (no route) and replace it once
 * the route/HR become available (e.g. after granting location permission).
 */
export async function importedWorkoutsByExternalId(): Promise<Map<string, WorkoutMeta>> {
  const rows = await db.workouts.where('externalId').notEqual('').toArray();
  const map = new Map<string, WorkoutMeta>();
  for (const w of rows) if (w.externalId) map.set(w.externalId, w);
  return map;
}

/** Load one full workout including its track. */
export async function getWorkout(id: string): Promise<Workout | undefined> {
  const meta = await db.workouts.get(id);
  if (!meta) return undefined;
  const track = await db.tracks.get(id);
  return { ...meta, track: track?.points ?? [] };
}

// --- Goals -----------------------------------------------------------------

export async function listGoals(): Promise<Goal[]> {
  const all = await db.goals.orderBy('createdAt').toArray();
  return all.reverse();
}

export async function saveGoal(goal: Goal): Promise<void> {
  await db.goals.put(goal);
}

export async function deleteGoal(id: string): Promise<void> {
  await db.goals.delete(id);
}

// --- Interval plans --------------------------------------------------------

export async function listPlans(): Promise<IntervalPlan[]> {
  const all = await db.plans.orderBy('createdAt').toArray();
  return all.reverse();
}

export async function savePlan(plan: IntervalPlan): Promise<void> {
  await db.plans.put(plan);
}

export async function deletePlan(id: string): Promise<void> {
  await db.plans.delete(id);
}

/**
 * Re-run deriveSummary over every stored workout so existing rows pick up newly
 * added summary fields (laps, calories, training load…). Pure over the stored
 * track. Returns the number of workouts updated.
 */
export async function rederiveAll(opts: {
  maxHr?: number | null;
  restingHr?: number | null;
  weightKg?: number | null;
}): Promise<number> {
  const metas = await db.workouts.toArray();
  let n = 0;
  for (const meta of metas) {
    const track = await db.tracks.get(meta.id);
    if (!track || track.points.length < 2) continue;
    const summary = deriveSummary(track.points, meta.sport, opts);
    // Imported workouts (Samsung / Health Connect) carry platform-authoritative
    // headline values that the track alone can't reproduce — e.g. real distance
    // and duration when GPS only captured a fragment. Re-deriving from the track
    // must NOT clobber those, or a recalc silently drops a 2.75 km run to the
    // 0.64 km GPS happened to record. Preserve them; only refresh the genuinely
    // track-derived extras (elevation, zones, training load, charts…).
    const old = meta.summary;
    if (meta.source !== 'manual') {
      summary.distanceM = old.distanceM;
      summary.durationMovingSec = old.durationMovingSec;
      summary.durationElapsedSec = old.durationElapsedSec;
      summary.avgPaceSecPerKm = old.avgPaceSecPerKm;
      summary.avgSpeedKmh = old.avgSpeedKmh;
      summary.avgHr = old.avgHr;
      summary.maxHr = old.maxHr;
      summary.avgCadence = old.avgCadence;
      summary.maxCadence = old.maxCadence;
      summary.totalSteps = old.totalSteps;
    }
    // These the derivation never knows regardless of source.
    if (old.calories != null) summary.calories = old.calories;
    if (old.vo2Max != null) summary.vo2Max = old.vo2Max;
    if (old.laps?.length) summary.laps = old.laps;
    await db.workouts.put({ ...meta, summary });
    n++;
  }
  return n;
}
