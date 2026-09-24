import { Capacitor } from '@capacitor/core';
import { getWorkout, saveWorkout } from '@/db/db';
import { buildWorkoutFromTrack, type RawLap } from '@/record/engine';
import type { Sport, TrackPoint } from '@/model/workout';
import { WearBridge } from '@/plugins/wearHr';

/** Shape of ExerciseService.buildWorkoutJson() on the watch. */
interface WatchWorkoutJson {
  id: string;
  sport: string;
  startedAt: string;
  track: Array<{
    t: number;
    lat: number;
    lng: number;
    alt: number | null;
    hr: number | null;
    cad: number | null;
    speed: number | null;
    power: number | null;
  }>;
  laps: RawLap[];
  summary: { distanceM: number; durationSec: number };
}

/** Convert one watch-recorded workout JSON into a normalized Workout and store
 * it (skipping if already imported), then ack it back to the watch. Never throws. */
export async function importWatchWorkout(json: string): Promise<void> {
  try {
    const w = JSON.parse(json) as WatchWorkoutJson;
    if (!w?.id || !Array.isArray(w.track)) return;
    if (await getWorkout(w.id)) {
      await ackWorkout(w.id); // already imported (e.g. re-delivered after a crash) — just ack
      return;
    }
    const sport: Sport = w.sport === 'walk' || w.sport === 'ride' ? w.sport : 'run';
    const points: TrackPoint[] = w.track.map((p) => ({
      t: p.t,
      lat: p.lat,
      lng: p.lng,
      alt: p.alt,
      hr: p.hr,
      cad: p.cad,
      speed: p.speed,
      power: p.power,
    }));
    if (points.length < 2) {
      await ackWorkout(w.id); // too short to import — still clear it off the watch
      return;
    }
    const workout = buildWorkoutFromTrack(
      sport,
      Date.parse(w.startedAt),
      points,
      w.laps ?? [],
      'watch',
      w.id,
    );
    await saveWorkout(workout);
    await ackWorkout(w.id);
  } catch (e) {
    console.warn('importWatchWorkout failed:', e);
  }
}

async function ackWorkout(id: string): Promise<void> {
  try {
    await WearBridge.ackWorkout({ id });
  } catch {
    // best-effort — a missed ack just means the watch retries next resume
  }
}

/** Drain any workouts the watch already pushed while the app was closed. Call
 * once on app start. Never throws. */
export async function syncWatchWorkouts(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { workouts } = await WearBridge.getPendingWorkouts();
    for (const w of workouts) await importWatchWorkout(w.json);
  } catch (e) {
    console.warn('syncWatchWorkouts failed:', e);
  }
}
