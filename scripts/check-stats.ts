/**
 * Self-check for Stats screen pure helpers (week bars, month grid, day size
 * buckets, route path). Run with `npx tsx scripts/check-stats.ts`.
 */
import {
  buildWeeklyBars,
  buildMonthGrid,
  daySizeBucket,
  monthTotals,
  routePreviewPath,
  isWatchRecorded,
} from '../src/metrics/statsView';
import type { WorkoutMeta } from '../src/db/db';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('ok:', msg);
  }
}

function w(startedAt: string, distanceM: number, source: WorkoutMeta['source'] = 'manual'): WorkoutMeta {
  return {
    id: startedAt,
    sport: 'run',
    source,
    startedAt,
    timezone: 'UTC',
    summary: {
      durationMovingSec: 600,
      durationElapsedSec: 600,
      distanceM,
      avgPaceSecPerKm: null,
      avgSpeedKmh: null,
      elevGainM: 0,
      elevLossM: 0,
      avgHr: null,
      maxHr: null,
      calories: null,
      splits: [],
      maxSpeedKmh: null,
      avgCadence: null,
      maxCadence: null,
      avgPower: null,
      maxPower: null,
      totalSteps: null,
      vo2Max: null,
      gradeAdjustedPaceSecPerKm: null,
      hrZones: null,
      bestEfforts: [],
      bounds: null,
      laps: [],
      longestContinuousM: 0,
      trainingLoad: null,
      routePreview: [],
    },
    title: 'Run',
    notes: '',
    athleteId: 'me',
    externalId: null,
  };
}

// buildWeeklyBars: 8 bars, current week last, tiers correct, month shown once
const now = new Date('2026-09-23T12:00:00'); // Wednesday
const workouts = [w('2026-09-22T08:00:00', 5000), w('2026-08-03T08:00:00', 3000)];
const bars = buildWeeklyBars(workouts, 8, now);
assert(bars.length === 8, 'buildWeeklyBars: 8 buckets');
assert(bars[7].tier === 'current' && bars[6].tier === 'last', 'buildWeeklyBars: tiers');
assert(bars[7].km === 5, 'buildWeeklyBars: current week distance');
const monthLabels = bars.filter((b) => /[A-Za-z]/.test(b.label));
assert(monthLabels.length >= 1, 'buildWeeklyBars: at least one month label shown');

// buildMonthGrid: Monday-start, pads to full weeks, marks today/future
const grid = buildMonthGrid(workouts, new Date(2026, 8, 1), now); // Sept 2026
assert(grid.length % 7 === 0, 'buildMonthGrid: full weeks');
const sept1 = grid.find((c) => c.iso === '2026-09-01');
assert(!!sept1, 'buildMonthGrid: Sept 1 present');
const sept22 = grid.find((c) => c.iso === '2026-09-22');
assert(!!sept22 && sept22.distanceM === 5000, 'buildMonthGrid: distance attributed to day');
const today = grid.find((c) => c.isToday);
assert(!!today && today.iso === '2026-09-23', 'buildMonthGrid: today flagged');
const future = grid.find((c) => c.iso === '2026-09-30');
assert(!!future && future.isFuture, 'buildMonthGrid: future day flagged');
assert(!today!.isFuture, 'buildMonthGrid: today is not future');

// Sept 1 2026 is a Tuesday -> first cell (Monday) should be padding
assert(grid[0].date === null, 'buildMonthGrid: leading pad before Tue-starting month');

// daySizeBucket
assert(daySizeBucket(0, 5000) === null, 'daySizeBucket: no activity -> null');
assert(daySizeBucket(1000, 5000) === 'small', 'daySizeBucket: small');
assert(daySizeBucket(2500, 5000) === 'medium', 'daySizeBucket: medium');
assert(daySizeBucket(5000, 5000) === 'large', 'daySizeBucket: large (max)');

// monthTotals
const mt = monthTotals(workouts, new Date(2026, 8, 1));
assert(mt.count === 1 && mt.distanceM === 5000, 'monthTotals: filters to month');

// routePreviewPath
assert(routePreviewPath([]) === null, 'routePreviewPath: empty -> null');
assert(routePreviewPath([[1, 1]]) === null, 'routePreviewPath: single point -> null');
const path = routePreviewPath([[0, 0], [1, 1], [0, 1]], 44, 5);
assert(!!path && path.split(' ').length === 3, 'routePreviewPath: one coord per point');

// isWatchRecorded
assert(isWatchRecorded('manual') === false, 'isWatchRecorded: manual -> phone');
assert(isWatchRecorded('samsung-health') === true, 'isWatchRecorded: samsung-health -> watch');
assert(isWatchRecorded('health-connect') === true, 'isWatchRecorded: health-connect -> watch');

if (process.exitCode) {
  console.error('\nstats checks FAILED');
} else {
  console.log('\nall stats checks passed');
}
