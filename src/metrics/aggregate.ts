import type { WorkoutMeta } from '@/db/db';

export interface Totals {
  count: number;
  distanceM: number;
  durationSec: number;
  elevGainM: number;
}

export function sumTotals(workouts: WorkoutMeta[]): Totals {
  return workouts.reduce<Totals>(
    (acc, w) => ({
      count: acc.count + 1,
      distanceM: acc.distanceM + w.summary.distanceM,
      durationSec: acc.durationSec + w.summary.durationMovingSec,
      elevGainM: acc.elevGainM + w.summary.elevGainM,
    }),
    { count: 0, distanceM: 0, durationSec: 0, elevGainM: 0 },
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
