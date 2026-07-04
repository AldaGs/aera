import type { WorkoutMeta } from '@/db/db';

export interface Totals {
  count: number;
  distanceM: number;
  durationSec: number;
  elevGainM: number;
  totalSteps: number;
}

export function sumTotals(workouts: WorkoutMeta[]): Totals {
  return workouts.reduce<Totals>(
    (acc, w) => ({
      count: acc.count + 1,
      distanceM: acc.distanceM + w.summary.distanceM,
      durationSec: acc.durationSec + w.summary.durationMovingSec,
      elevGainM: acc.elevGainM + w.summary.elevGainM,
      totalSteps: acc.totalSteps + (w.summary.totalSteps ?? 0),
    }),
    { count: 0, distanceM: 0, durationSec: 0, elevGainM: 0, totalSteps: 0 },
  );
}

/** Monday-based start of the week containing `d`, at local midnight. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - day);
  return x;
}

export type Range = 'week' | 'month' | 'year' | 'all';

export function rangeStart(range: Range, now = new Date()): Date | null {
  switch (range) {
    case 'week':
      return startOfWeek(now);
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
    case 'all':
      return null;
  }
}

export function filterByRange(workouts: WorkoutMeta[], range: Range): WorkoutMeta[] {
  const start = rangeStart(range);
  if (!start) return workouts;
  const ms = start.getTime();
  return workouts.filter((w) => new Date(w.startedAt).getTime() >= ms);
}

/** Total distance (m) within the ISO week starting at `weekStart` (local). */
export function weekDistanceM(workouts: WorkoutMeta[], weekStart: Date): number {
  const from = weekStart.getTime();
  const to = from + 7 * 86400000;
  return workouts
    .filter((w) => {
      const t = new Date(w.startedAt).getTime();
      return t >= from && t < to;
    })
    .reduce((a, w) => a + w.summary.distanceM, 0);
}

/** Count of consecutive weeks (ending this week) with at least one activity. */
export function activeWeekStreak(workouts: WorkoutMeta[]): number {
  const weeks = new Set(
    workouts.map((w) => startOfWeek(new Date(w.startedAt)).getTime()),
  );
  let streak = 0;
  const cursor = startOfWeek(new Date());
  while (weeks.has(cursor.getTime())) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

/** Activity counts by weekday (0=Mon..6=Sun). */
export function weekdayCounts(workouts: WorkoutMeta[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const w of workouts) {
    const day = (new Date(w.startedAt).getDay() + 6) % 7;
    counts[day]++;
  }
  return counts;
}

/** Buckets last `weeks` weeks of distance (km) for a simple trend bar chart. */
export function weeklyDistanceBuckets(
  workouts: WorkoutMeta[],
  weeks = 8,
): { label: string; km: number; weekStart: number }[] {
  const now = new Date();
  const thisWeek = startOfWeek(now);
  const buckets: { label: string; km: number; weekStart: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisWeek);
    ws.setDate(ws.getDate() - i * 7);
    buckets.push({
      label: ws.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      km: 0,
      weekStart: ws.getTime(),
    });
  }
  for (const w of workouts) {
    const t = new Date(w.startedAt).getTime();
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i].weekStart) {
        buckets[i].km += w.summary.distanceM / 1000;
        break;
      }
    }
  }
  return buckets;
}
