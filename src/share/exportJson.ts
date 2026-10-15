import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { Workout, WorkoutSource } from '@/model/workout';
import { summaryInvariantViolations } from '@/metrics/deriveSummary';
import { loadProfile, zoneModel } from '@/store/profile';
import { version } from '../../package.json';
import { carryCadence, distanceSpeeds, downsampleIndexes, staleFixIndexes } from './exportSamples';
import { shareOrDownloadFile } from './shareImage';

const SAMPLE_EVERY_MS = 5000;

/** Bump when the export shape changes; readers switch on it. v1 → v2: split
 * `source` into hrSource/gpsSource, `notes` became { text, corrections },
 * zones carry their real method, summary gained gpsGaps/splitsScope/
 * runAvgPaceSecPerKm, samples gained a `fix` column. v2 → v3: `source`
 * dropped, zone method 'thresholds' → 'at_ant', added paceSource, rpe, plan,
 * trainingLoadMethod, cadenceSampleCount, data-quality warnings; samples keep
 * per-bucket HR peaks, `speed_ms` is GPS-distance speed (device speed moved to
 * `device_speed_ms`), and gained `cad_carried` / `stale` columns. */
export const EXPORT_SCHEMA_VERSION = 3;

/** How every pace/speed number in the export is derived. */
const PACE_SOURCE = 'gps_distance';

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
  const track = w.track;
  const kept = downsampleIndexes(track, SAMPLE_EVERY_MS);
  const speeds = distanceSpeeds(track, kept, w.sport);
  const stale = staleFixIndexes(track);
  const cadence = carryCadence(track);
  const b = zones?.boundaries;
  const thresholds = zones?.method === 'thresholds';

  // Data-quality flags: derived-summary invariants plus sensor problems.
  const warnings = [...summaryInvariantViolations(w.summary)];
  if (stale.size > 0)
    warnings.push(`stale_gps: ${stale.size} fix(es) repeat the previous position with speed > 0 (flagged stale=1)`);
  if (!hasHr) warnings.push('missing_hr: no heart-rate samples');
  else {
    const hrs = track.map((p) => p.hr ?? 0);
    const firstHr = hrs.findIndex((h) => h > 0);
    if (firstHr >= 0 && track[firstHr].t > 30_000)
      warnings.push(`missing_hr: no heart rate for the first ${Math.round(track[firstHr].t / 1000)} s`);
    const exportedMax = Math.max(0, ...kept.map((i) => hrs[i]));
    if (summary.maxHr != null && exportedMax < summary.maxHr)
      warnings.push(`downsample_dropped_peak: samples max ${exportedMax} < summary maxHr ${summary.maxHr}`);
  }
  if (cadence.sampleCount > 0 && cadence.sampleCount < track.length * 0.5)
    warnings.push(`sparse_cadence: ${cadence.sampleCount} of ${track.length} points have cadence`);
  if (w.summary.gpsGaps?.length)
    warnings.push(`gps_gaps: ${w.summary.gpsGaps.length} span(s) without a fix; no distance counted across them`);

  return {
    format: `aera.workout.v${EXPORT_SCHEMA_VERSION}`,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: version,
    exportedAt: new Date().toISOString(),
    id: w.id,
    title: w.title,
    rpe: w.rpe ?? null, // 1 (very easy) .. 10 (max), asked when the session ends
    notes: {
      text: w.notes,
      // User overrides of known-wrong values; summary below stays as derived.
      corrections: w.corrections ?? [],
    },
    // What the athlete intended (null for free runs), to compare with the laps.
    plan: w.plan ?? null,
    sport: w.sport,
    hrSource: hrSourceOf(w),
    gpsSource: gpsSourceOf(w),
    // Distance, splits, laps, every pace field and samples.speed_ms all come
    // from GPS segment distances (device speed only where GPS stalls).
    paceSource: PACE_SOURCE,
    startedAt: w.startedAt,
    timezone: w.timezone,
    zones: zones
      ? {
          method: thresholds ? 'at_ant' : 'pct_max_hr',
          maxHr: zones.maxHr,
          maxHrSource: profile.maxHrAuto ? 'auto_observed' : profile.maxHr ? 'user' : 'age_estimate',
          // Sport the max HR was observed in (null = user-set / estimate).
          maxHrSport: profile.maxHrAuto ? profile.maxHrSport : null,
          runMaxHr: profile.runMaxHr, // highest sustained HR seen in a run
          aerobicThresholdHr: profile.aerobicThresholdHr,
          anaerobicThresholdHr: profile.anaerobicThresholdHr,
          restingHr: profile.restingHr,
          // Z1 < b[0] ≤ Z2 < b[1] ≤ Z3 < b[2] ≤ Z4 < b[3] ≤ Z5 (bpm)
          boundaries: zones.boundaries,
        }
      : null,
    hrCeiling: profile.hrCeiling,
    warnings,
    summary: {
      ...summary, // laps = intervals (startMs/endMs from workout start)
      avgHr: hasHr ? summary.avgHr : null,
      trainingLoad: hasHr ? summary.trainingLoad : null,
      // Σ minutes in zone × zone number (Z1 = 1 … Z5 = 5).
      trainingLoadMethod: hasHr && summary.trainingLoad != null ? 'zone_weighted_minutes' : null,
      cadenceSampleCount: cadence.sampleCount,
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
      // One per bucket, plus the bucket's HR peak when higher, so the max HR
      // here always equals summary.maxHr. Gaps are longer where there was no fix.
      minIntervalMs: SAMPLE_EVERY_MS,
      // speed_ms: distance since the previous row / time (paceSource);
      // device_speed_ms: raw watch/GPS-chip speed, for reference only.
      // fix: 1 = real GPS fix, 0 = HR-only sample (lat/lng carried from the nearest fix)
      // cad_carried: 1 = cadence carried forward from the last reading (≤ 30 s old)
      // stale: 1 = fix repeats the previous position with speed > 0 (ignore its lat/lng)
      fields: ['t_ms', 'lat', 'lng', 'alt_m', 'hr', 'speed_ms', 'device_speed_ms', 'cad', 'cad_carried', 'fix', 'stale'],
      rows: kept.map((idx, k) => {
        const p = track[idx];
        return [
          p.t,
          p.lat,
          p.lng,
          p.alt != null && Math.abs(p.alt) < 10000 ? p.alt : null,
          p.hr,
          speeds[k],
          p.speed,
          cadence.cad[idx],
          cadence.carried[idx] ? 1 : 0,
          p.noFix ? 0 : 1,
          stale.has(idx) ? 1 : 0,
        ];
      }),
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
