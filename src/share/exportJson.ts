import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Workout } from '@/model/workout';
import { effectiveMaxHr, loadProfile } from '@/store/profile';
import { version } from '../../package.json';
import { shareOrDownloadFile } from './shareImage';

const SAMPLE_EVERY_MS = 5000;

/** Raw export: a superset of what the detail screen shows, plus the inputs
 * (zone boundaries, HR/GPS samples) needed to recompute any derived number. */
export function workoutToJson(w: Workout) {
  const profile = loadProfile();
  const maxHr = effectiveMaxHr(profile);
  const { routePreview: _omit, ...summary } = w.summary;
  let nextT = -Infinity;
  const samples = w.track.filter((p) => {
    if (p.t < nextT) return false;
    nextT = p.t + SAMPLE_EVERY_MS;
    return true;
  });
  return {
    format: 'aera.workout.v1',
    appVersion: version,
    exportedAt: new Date().toISOString(),
    id: w.id,
    title: w.title,
    notes: w.notes,
    sport: w.sport,
    source: w.source,
    startedAt: w.startedAt,
    timezone: w.timezone,
    zones: maxHr
      ? {
          method: 'pct_max_hr',
          maxHr,
          restingHr: profile.restingHr,
          // Z1 < b[0] ≤ Z2 < b[1] ≤ Z3 < b[2] ≤ Z4 < b[3] ≤ Z5 (bpm)
          boundaries: [0.6, 0.7, 0.8, 0.9].map((f) => Math.round(f * maxHr)),
        }
      : null,
    summary: {
      ...summary, // laps = intervals (startMs/endMs from workout start)
      hrZones: summary.hrZones?.map((timeSec, i) => ({
        zone: i + 1,
        lowBpm: maxHr ? Math.round([0, 0.6, 0.7, 0.8, 0.9][i] * maxHr) : null,
        highBpm: maxHr && i < 4 ? Math.round([0.6, 0.7, 0.8, 0.9][i] * maxHr) : null,
        timeSec: Math.round(timeSec),
      })) ?? null,
    },
    samples: {
      minIntervalMs: SAMPLE_EVERY_MS, // gaps can be longer where the sensor had no fix
      fields: ['t_ms', 'lat', 'lng', 'alt_m', 'hr', 'speed_ms', 'cad'],
      rows: samples.map((p) => [p.t, p.lat, p.lng, p.alt != null && Math.abs(p.alt) < 10000 ? p.alt : null, p.hr, p.speed, p.cad]),
    },
  };
}

export async function exportWorkoutJson(w: Workout) {
  const json = JSON.stringify(workoutToJson(w), null, 1);
  const filename = `aera-${w.startedAt.slice(0, 10)}-${w.id.slice(0, 8)}.json`;
  if (!Capacitor.isNativePlatform()) {
    await shareOrDownloadFile(new Blob([json], { type: 'application/json' }), filename);
    return;
  }
  try {
    // Public Documents folder, so the file shows up in My Files → Documents/aera.
    await Filesystem.writeFile({
      path: `aera/${filename}`,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    alert(`Saved to Documents/aera/${filename}`);
  } catch (e) {
    alert(`Couldn't save export: ${e instanceof Error ? e.message : e}`);
  }
}
