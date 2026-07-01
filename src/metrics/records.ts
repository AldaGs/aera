import type { WorkoutMeta } from '@/db/db';
import { fmtDistance, fmtDuration, fmtPace } from '@/format';

export interface PersonalRecord {
  label: string;
  value: string;
  workoutId: string | null;
}

/** Fastest time over a target distance across all runs, via cached best-efforts. */
function fastestEffort(
  workouts: WorkoutMeta[],
  targetM: number,
): { workoutId: string; durationSec: number } | null {
  let best: { workoutId: string; durationSec: number } | null = null;
  for (const w of workouts) {
    const e = w.summary.bestEfforts?.find((b) => b.distanceM === targetM);
    if (e && (!best || e.durationSec < best.durationSec)) {
      best = { workoutId: w.id, durationSec: e.durationSec };
    }
  }
  return best;
}

function longestBy(
  items: WorkoutMeta[],
  pick: (w: WorkoutMeta) => number,
): { workoutId: string; value: number } | null {
  let best: { workoutId: string; value: number } | null = null;
  for (const w of items) {
    const v = pick(w);
    if (!best || v > best.value) best = { workoutId: w.id, value: v };
  }
  return best;
}

export function computeRecords(all: WorkoutMeta[]): PersonalRecord[] {
  const runs = all.filter((w) => w.sport === 'run');
  const rides = all.filter((w) => w.sport === 'ride');

  const fastest1k = fastestEffort(runs, 1000);
  const fastest5k = fastestEffort(runs, 5000);
  const fastest10k = fastestEffort(runs, 10000);
  const longestRun = longestBy(runs, (w) => w.summary.distanceM);
  const longestRide = longestBy(rides, (w) => w.summary.distanceM);
  const mostElev = longestBy(all, (w) => w.summary.elevGainM);

  return [
    {
      label: 'Fastest 1K',
      value: fastest1k ? fmtDuration(fastest1k.durationSec) : '—',
      workoutId: fastest1k?.workoutId ?? null,
    },
    {
      label: 'Fastest 5K',
      value: fastest5k ? fmtPace(fastest5k.durationSec / 5) : '—',
      workoutId: fastest5k?.workoutId ?? null,
    },
    {
      label: 'Fastest 10K',
      value: fastest10k ? fmtDuration(fastest10k.durationSec) : '—',
      workoutId: fastest10k?.workoutId ?? null,
    },
    {
      label: 'Longest run',
      value: longestRun ? fmtDistance(longestRun.value) : '—',
      workoutId: longestRun?.workoutId ?? null,
    },
    {
      label: 'Longest ride',
      value: longestRide ? fmtDistance(longestRide.value) : '—',
      workoutId: longestRide?.workoutId ?? null,
    },
    {
      label: 'Most elevation',
      value: mostElev && mostElev.value > 0 ? `${Math.round(mostElev.value)} m` : '—',
      workoutId: mostElev?.workoutId ?? null,
    },
  ];
}
