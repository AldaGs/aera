import Dexie, { type Table } from 'dexie';
import type { TrackPoint, Workout } from '@/model/workout';

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

/** Load one full workout including its track. */
export async function getWorkout(id: string): Promise<Workout | undefined> {
  const meta = await db.workouts.get(id);
  if (!meta) return undefined;
  const track = await db.tracks.get(id);
  return { ...meta, track: track?.points ?? [] };
}
