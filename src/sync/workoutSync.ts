import { Capacitor } from '@capacitor/core';
import { getWorkout, listWorkouts, saveWorkout } from '@/db/db';
import { buildWorkoutFromTrack, type RawLap } from '@/record/engine';
import type { Sport, TrackPoint, Workout } from '@/model/workout';
import { WearBridge } from '@/plugins/wearHr';
import { denoiseTrack } from '@/metrics/denoiseTrack';

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
    const raw: TrackPoint[] = w.track.map((p) => ({
      t: p.t,
      lat: p.lat,
      lng: p.lng,
      alt: p.alt,
      hr: p.hr,
      cad: p.cad,
      speed: p.speed,
      power: p.power,
    }));
    // Raw watch GPS: pin standing-still wobble (e.g. a warm-up in place) so it
    // doesn't become distance on the map, splits and laps.
    const points = denoiseTrack(raw, sport);
    const durationSec = w.summary?.durationSec ?? 0;
    if (points.length < 2 && durationSec < 10) {
      await ackWorkout(w.id); // accidental start/stop — nothing worth keeping
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
    // No GPS (indoors, or a warm-up in place): keep the run with the watch's own
    // totals instead of dropping it — distance comes from its step-based estimate.
    if (points.length < 2) {
      applyWatchTotals(workout.summary, w.summary.distanceM ?? 0, durationSec, sport);
    } else if ((w.summary?.distanceM ?? 0) > 0) {
      // Trust the watch's total (Health Services fuses GPS + steps), like the
      // Samsung import does; keep our GPS-derived moving time.
      applyWatchDistance(workout.summary, w.summary.distanceM, sport);
    }
    await saveWorkout(workout);
    await ackWorkout(w.id);
  } catch (e) {
    console.warn('importWatchWorkout failed:', e);
  }
}

function applyWatchTotals(
  s: Workout['summary'],
  distanceM: number,
  durationSec: number,
  sport: Sport,
): void {
  s.distanceM = distanceM;
  s.durationMovingSec = durationSec;
  s.durationElapsedSec = durationSec;
  const km = distanceM / 1000;
  if (sport === 'ride') s.avgSpeedKmh = durationSec > 0 ? km / (durationSec / 3600) : null;
  else s.avgPaceSecPerKm = km > 0.05 ? durationSec / km : null;
}

function applyWatchDistance(s: Workout['summary'], distanceM: number, sport: Sport): void {
  s.distanceM = distanceM;
  const km = distanceM / 1000;
  const sec = s.durationMovingSec;
  if (sport === 'ride') s.avgSpeedKmh = sec > 0 ? km / (sec / 3600) : null;
  else s.avgPaceSecPerKm = km > 0.05 ? sec / km : null;
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
export async function syncWatchWorkouts(): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;
  try {
    const { workouts } = await WearBridge.getPendingWorkouts();
    for (const w of workouts) await importWatchWorkout(w.json);
    return workouts.length;
  } catch (e) {
    console.warn('syncWatchWorkouts failed:', e);
    return 0;
  }
}

const DENOISE_DONE_KEY = 'aera.watchDenoise.v1';

/**
 * One-time pass (per device): re-run denoiseTrack over watch runs imported before
 * the filter existed, rebuilding their summary (distance, pace, splits, map) while
 * keeping title/notes and the interval laps. Returns how many were updated.
 */
export async function redenoiseWatchWorkouts(): Promise<number> {
  try {
    if (localStorage.getItem(DENOISE_DONE_KEY)) return 0;
  } catch {
    return 0;
  }
  let n = 0;
  try {
    for (const meta of await listWorkouts()) {
      if (meta.source !== 'watch') continue;
      const w = await getWorkout(meta.id);
      if (!w || w.track.length < 2) continue;
      const points = denoiseTrack(w.track, w.sport);
      const laps: RawLap[] = (w.summary.laps ?? [])
        .filter((l) => l.label) // planned interval laps; plain km splits get re-derived
        .map((l) => ({
          startMs: l.startMs,
          endMs: l.endMs,
          kind: l.type === 'rest' ? 'recovery' : l.type === 'walk' ? 'walk' : 'run',
          label: l.label ?? '',
        }));
      const rebuilt = buildWorkoutFromTrack(w.sport, Date.parse(w.startedAt), points, laps, 'watch', w.id);
      await saveWorkout({ ...w, track: points, summary: rebuilt.summary });
      n++;
    }
    localStorage.setItem(DENOISE_DONE_KEY, '1');
  } catch (e) {
    console.warn('redenoiseWatchWorkouts failed:', e);
  }
  return n;
}
