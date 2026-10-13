/**
 * Regression checks for the export/recording fixes: session-clock elapsed time,
 * HR through a GPS-less warm-up, longestContinuousM, lap semantics, GPS gaps,
 * run-scoped splits, and null HR fields without HR.
 * Run with `npx tsx scripts/check-session-metrics.ts`.
 */
import { buildWorkoutFromTrack, type RawLap } from '../src/record/engine';
import { hrZoneIndex, summaryInvariantViolations } from '../src/metrics/deriveSummary';
import type { TrackPoint } from '../src/model/workout';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

const M_PER_DEG = 111_195;
function pt(t: number, lat: number, hr: number | null): TrackPoint {
  return { t, lat, lng: -99.0, alt: null, hr, cad: null, speed: null, power: null };
}

// 0–300 s timed warm-up: GPS skipped, HR only. 300–600 s walk at 1.2 m/s.
// 600–1208 s run at 3 m/s with a 3 s slowdown every 30 s (smoothing wobble)
// and a 40 s screen-off gap at 900–940 s. Then a 0.5 s trailing lap.
const points: TrackPoint[] = [];
const hrSamples: [number, number][] = [];
for (let t = 0; t < 300_000; t += 5000) hrSamples.push([t, 100]);
let lat = 19.4;
for (let t = 300_000; t <= 1_208_000; t += 1000) {
  if (t > 900_000 && t < 940_000) {
    lat += 3 / M_PER_DEG; // moving, but no fixes recorded
    continue;
  }
  const v = t < 600_000 ? 1.2 : (t / 1000) % 30 < 3 ? 1.8 : 3;
  if (t > 300_000) lat += v / M_PER_DEG;
  points.push(pt(t, lat, t < 600_000 ? 110 : 160));
}
const laps: RawLap[] = [
  { startMs: 0, endMs: 300_000, kind: 'warmup', label: 'Warm-up' },
  { startMs: 300_000, endMs: 600_000, kind: 'walk', label: 'Walk' },
  { startMs: 600_000, endMs: 1_208_000, kind: 'run', label: 'Run' },
  { startMs: 1_208_000, endMs: 1_208_500, kind: 'run', label: '' },
];
const w = buildWorkoutFromTrack('run', Date.now(), points, laps, 'manual', 'x', {
  hrSamples,
  timeline: { elapsedSec: 1208.5, movingSec: 1208.5 },
});
const s = w.summary;

// 1. Time
assert(Math.abs(s.durationElapsedSec - 1208.5) < 0.01, `elapsed is the session clock (1208.5), got ${s.durationElapsedSec}`);
assert(s.durationMovingSec <= s.durationElapsedSec, 'moving <= elapsed');
assert(summaryInvariantViolations(s).length === 0, `no invariant violations: ${summaryInvariantViolations(s).join('; ')}`);
const noTimeline = buildWorkoutFromTrack('run', Date.now(), points, laps, 'manual', 'y');
assert(noTimeline.summary.durationElapsedSec === 1208, `without a session clock, elapsed = last t (1208), got ${noTimeline.summary.durationElapsedSec}`);

// 2. Warm-up HR
const warm = s.laps[0];
assert(warm.avgHr != null && Math.abs(warm.avgHr - 100) < 1, `warm-up lap has HR (~100), got ${warm.avgHr}`);

// 5. Laps
assert(warm.type === 'warmup', `warm-up lap typed warmup, got ${warm.type}`);
assert(warm.avgPaceSecPerKm === null, `warm-up pace null under 50 m, got ${warm.avgPaceSecPerKm}`);
assert(s.laps.length === 3, `0.5 s trailing lap dropped, got ${s.laps.length} laps`);
assert(s.splitsScope === 'run', `splits scoped to run laps, got ${s.splitsScope}`);
const runLap = s.laps[2];
assert(
  s.runAvgPaceSecPerKm != null && Math.abs(s.runAvgPaceSecPerKm - runLap.avgPaceSecPerKm!) < 1,
  `runAvgPace matches the run lap (${runLap.avgPaceSecPerKm?.toFixed(0)}), got ${s.runAvgPaceSecPerKm?.toFixed(0)}`,
);
const splitM = s.splits.reduce((a, x) => a + x.distanceM, 0);
assert(Math.abs(splitM - runLap.distanceM) < 1, `splits cover the run only (${runLap.distanceM.toFixed(0)} m), got ${splitM.toFixed(0)}`);

// 3. Longest continuous
assert(s.longestContinuousM >= 800, `longest continuous bridges speed dips (>= 800 m), got ${s.longestContinuousM.toFixed(0)}`);

// 6. GPS gaps
assert(s.gpsGaps.length === 1 && s.gpsGaps[0].startMs === 900_000, `one GPS gap at 900 s, got ${JSON.stringify(s.gpsGaps)}`);
const jump = points.slice();
jump.splice(700, 0, { ...jump[699], t: jump[699].t + 500, lat: jump[699].lat + 0.05 }); // 5.5 km in 0.5 s
const tele = buildWorkoutFromTrack('run', Date.now(), jump, [], 'manual', 'z');
assert(tele.summary.maxSpeedKmh! < 45, `speed outlier clamped, max ${tele.summary.maxSpeedKmh?.toFixed(0)} km/h`);
assert(Math.abs(tele.summary.distanceM - noTimeline.summary.distanceM) < 1, 'teleport adds no distance');

// 4. Zones / null HR fields
const noHr = buildWorkoutFromTrack('run', Date.now(), points.map((p) => ({ ...p, hr: null })), [], 'manual', 'n');
assert(noHr.summary.hrZones === null && noHr.summary.avgHr === null && noHr.summary.trainingLoad === null, 'no HR → hrZones/avgHr/trainingLoad null');
assert(hrZoneIndex(140, [131, 141, 158, 174]) === 1, 'threshold zones: 140 bpm is Z2');
assert(hrZoneIndex(174, [131, 141, 158, 174]) === 4, 'threshold zones: AnT is Z5');
assert(hrZoneIndex(171, 190) === 4, 'pct zones unchanged: 90% is Z5');
