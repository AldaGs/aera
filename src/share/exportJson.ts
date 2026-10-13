import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Workout, WorkoutSource } from '@/model/workout';
import { summaryInvariantViolations } from '@/metrics/deriveSummary';
import { loadProfile, zoneModel } from '@/store/profile';
import { version } from '../../package.json';
import { shareOrDownloadFile } from './shareImage';

const SAMPLE_EVERY_MS = 5000;

/** Bump when the export shape changes; readers switch on it. v1 → v2: split
 * `source` into hrSource/gpsSource, `notes` became { text, corrections },
 * zones carry their real method, summary gained gpsGaps/splitsScope/
 * runAvgPaceSecPerKm, samples gained a `fix` column. */
export const EXPORT_SCHEMA_VERSION = 2;

type SensorSource = 'phone' | 'watch' | WorkoutSource;

/** Where the GPS track came from (null when the workout has no fixes). */
function gpsSourceOf(w: Workout): SensorSource | null {
  if (!w.track.some((p) => !p.noFix)) return null;
  return w.source === 'manual' ? 'phone' : w.source;
}

/** Where heart rate came from — phone recordings stream it from the watch. */
function hrSourceOf(w: Workout): SensorSource | null {
  if (!w.track.some((p) => p.hr != null && p.hr > 0)) return null;
  return w.source === 'manual' ? 'watch' : w.source;
}

/** Raw export: a superset of what the detail screen shows, plus the inputs
 * (zone boundaries, HR/GPS samples) needed to recompute any derived number. */
export function workoutToJson(w: Workout) {
  const profile = loadProfile();
  const zones = zoneModel(profile);
  const { routePreview: _omit, ...summary } = w.summary;
  const hasHr = summary.avgHr != null;
  let nextT = -Infinity;
  const samples = w.track.filter((p) => {
    if (p.t < nextT) return false;
    nextT = p.t + SAMPLE_EVERY_MS;
    return true;
  });
  const b = zones?.boundaries;
  return {
    format: `aera.workout.v${EXPORT_SCHEMA_VERSION}`,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: version,
    exportedAt: new Date().toISOString(),
    id: w.id,
    title: w.title,
    notes: {
      text: w.notes,
      // User overrides of known-wrong values; summary below stays as derived.
      corrections: w.corrections ?? [],
    },
    sport: w.sport,
    source: w.source, // how the workout entered aera
    hrSource: hrSourceOf(w),
    gpsSource: gpsSourceOf(w),
    startedAt: w.startedAt,
    timezone: w.timezone,
    zones: zones
      ? {
          method: zones.method, // 'pct_max_hr' | 'thresholds'
          maxHr: zones.maxHr,
          maxHrSource: profile.maxHrAuto ? 'auto_observed' : profile.maxHr ? 'user' : 'age_estimate',
          aerobicThresholdHr: zones.method === 'thresholds' ? profile.aerobicThresholdHr : null,
          anaerobicThresholdHr: zones.method === 'thresholds' ? profile.anaerobicThresholdHr : null,
          restingHr: profile.restingHr,
          // Z1 < b[0] ≤ Z2 < b[1] ≤ Z3 < b[2] ≤ Z4 < b[3] ≤ Z5 (bpm)
          boundaries: zones.boundaries,
        }
      : null,
    warnings: summaryInvariantViolations(w.summary),
    summary: {
      ...summary, // laps = intervals (startMs/endMs from workout start)
      avgHr: hasHr ? summary.avgHr : null,
      trainingLoad: hasHr ? summary.trainingLoad : null,
      hrZones:
        hasHr && summary.hrZones
          ? summary.hrZones.map((timeSec, i) => ({
              zone: i + 1,
              lowBpm: b ? (i === 0 ? 0 : b[i - 1]) : null,
              highBpm: b && i < 4 ? b[i] : null,
              timeSec: Math.round(timeSec),
            }))
          : null,
    },
    samples: {
      minIntervalMs: SAMPLE_EVERY_MS, // gaps can be longer where the sensor had no fix
      // fix: 1 = real GPS fix, 0 = HR-only sample (lat/lng carried from the nearest fix)
      fields: ['t_ms', 'lat', 'lng', 'alt_m', 'hr', 'speed_ms', 'cad', 'fix'],
      rows: samples.map((p) => [
        p.t,
        p.lat,
        p.lng,
        p.alt != null && Math.abs(p.alt) < 10000 ? p.alt : null,
        p.hr,
        p.speed,
        p.cad,
        p.noFix ? 0 : 1,
      ]),
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
