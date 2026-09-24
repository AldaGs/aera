/**
 * Tiny self-check for Phase 5 watch->phone workout import: a sample watch
 * ExerciseService.buildWorkoutJson() payload (with laps + HR) converts into a
 * normalized Workout with the expected distance/duration/laps/source, and the
 * watch id survives as the Workout id (the dedup key getWorkout()/saveWorkout()
 * use). Run with `npx tsx scripts/check-watch-import.ts`. No framework; asserts
 * and exits non-zero on failure.
 */
import { buildWorkoutFromTrack, type RawLap } from '../src/record/engine';
import type { TrackPoint } from '../src/model/workout';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

// Two 500 m-ish legs ~0.0045 deg apart in latitude (roughly 500 m), 10 points
// each 1 min apart: a warm-up walk then a work run, matching the
// ExerciseService plan-lap shape (kind/label per boundary).
const points: TrackPoint[] = [];
let lat = 40.0;
for (let i = 0; i < 20; i++) {
  points.push({
    t: i * 60_000,
    lat,
    lng: -73.0,
    alt: null,
    hr: i < 10 ? 120 : 150,
    cad: null,
    speed: null,
    power: null,
  });
  lat += 0.00045;
}
const laps: RawLap[] = [
  { startMs: 0, endMs: 9 * 60_000, kind: 'walk', label: 'Warm-up' },
  { startMs: 9 * 60_000, endMs: 19 * 60_000, kind: 'work', label: 'Work 1/1' },
];

const startedAtMs = Date.parse('2026-01-01T08:00:00.000Z');
const workout = buildWorkoutFromTrack('run', startedAtMs, points, laps, 'watch', 'watch-abc-123');

assert(workout.id === 'watch-abc-123', 'watch id carried through as the Workout id (dedup key)');
assert(workout.source === 'watch', 'source is "watch"');
assert(workout.summary.distanceM > 900 && workout.summary.distanceM < 1000, `distance ~900-1000m, got ${workout.summary.distanceM}`);
assert(workout.summary.durationMovingSec === 19 * 60, `duration 1140s, got ${workout.summary.durationMovingSec}`);
assert(workout.summary.laps.length === 2, `2 laps, got ${workout.summary.laps.length}`);
assert(workout.summary.laps[0].type === 'walk', `lap 0 type walk, got ${workout.summary.laps[0].type}`);
assert(workout.summary.laps[1].type === 'run', `lap 1 type run, got ${workout.summary.laps[1].type}`);
assert(workout.summary.laps[0].avgHr === 120, `lap 0 avgHr 120, got ${workout.summary.laps[0].avgHr}`);
assert(workout.summary.laps[1].avgHr === 150, `lap 1 avgHr 150, got ${workout.summary.laps[1].avgHr}`);
assert(workout.summary.avgHr != null && workout.summary.avgHr > 130, `overall avgHr reflects both legs, got ${workout.summary.avgHr}`);

// Empty laps: falls back to deriveSummary's own split, still builds fine.
const noLaps = buildWorkoutFromTrack('run', startedAtMs, points, [], 'watch', 'watch-no-laps');
assert(noLaps.summary.laps.length !== 2 || noLaps.summary.laps[0].label == null, 'no explicit laps -> not the plan-lap shape');
