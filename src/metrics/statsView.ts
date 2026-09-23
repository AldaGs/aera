// Pure helpers for the Stats screen (1d summary + 1f calendar). No DOM, no
// Date.now() defaults baked in — callers pass "now" so these stay testable.
import type { WorkoutMeta } from '@/db/db';
import { startOfWeek } from './aggregate';

export interface WeekBar {
  km: number;
  weekStart: number; // ms
  label: string; // "3 Aug" or "10" (month shown only when it changes)
  tier: 'current' | 'last' | 'past';
}

/** Last `weeks` ISO (Monday-start) weeks of distance, for the trend chart. */
export function buildWeeklyBars(
  workouts: WorkoutMeta[],
  weeks = 8,
  now = new Date(),
): WeekBar[] {
  const thisWeek = startOfWeek(now);
  const starts: Date[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisWeek);
    ws.setDate(ws.getDate() - i * 7);
    starts.push(ws);
  }
  let prevMonth = -1;
  const bars: WeekBar[] = starts.map((ws, i) => {
    const showMonth = ws.getMonth() !== prevMonth;
    prevMonth = ws.getMonth();
    const label = showMonth
      ? `${ws.getDate()} ${ws.toLocaleDateString(undefined, { month: 'short' })}`
      : `${ws.getDate()}`;
    const tier: WeekBar['tier'] =
      i === starts.length - 1 ? 'current' : i === starts.length - 2 ? 'last' : 'past';
    return { km: 0, weekStart: ws.getTime(), label, tier };
  });
  for (const w of workouts) {
    const t = new Date(w.startedAt).getTime();
    for (let i = bars.length - 1; i >= 0; i--) {
      if (t >= bars[i].weekStart) {
        bars[i].km += w.summary.distanceM / 1000;
        break;
      }
    }
  }
  return bars;
}

export interface DayCell {
  date: Date | null; // null = padding cell outside the month
  iso: string | null; // yyyy-mm-dd, local
  distanceM: number;
  isToday: boolean;
  isFuture: boolean;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Monday-start grid for the month containing `month`, padded to full weeks. */
export function buildMonthGrid(
  workouts: WorkoutMeta[],
  month: Date,
  now = new Date(),
): DayCell[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startPad = (first.getDay() + 6) % 7; // days before the 1st, Mon=0
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7;
  const todayIso = toIso(now);

  const byDay = new Map<string, number>();
  for (const w of workouts) {
    const d = new Date(w.startedAt);
    const iso = toIso(d);
    byDay.set(iso, (byDay.get(iso) ?? 0) + w.summary.distanceM);
  }

  const cells: DayCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startPad + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ date: null, iso: null, distanceM: 0, isToday: false, isFuture: false });
      continue;
    }
    const date = new Date(month.getFullYear(), month.getMonth(), dayNum);
    const iso = toIso(date);
    cells.push({
      date,
      iso,
      distanceM: byDay.get(iso) ?? 0,
      isToday: iso === todayIso,
      isFuture: date.getTime() > now.getTime() && iso !== todayIso,
    });
  }
  return cells;
}

export type DaySizeBucket = 'small' | 'medium' | 'large';

/** Bucket a day's distance against the month's max for dot size/color. */
export function daySizeBucket(distanceM: number, maxDistanceM: number): DaySizeBucket | null {
  if (distanceM <= 0) return null;
  const ratio = maxDistanceM > 0 ? distanceM / maxDistanceM : 0;
  if (ratio >= 0.75) return 'large';
  if (ratio >= 0.4) return 'medium';
  return 'small';
}

export interface MonthTotals {
  count: number;
  distanceM: number;
  durationSec: number;
}

export function monthTotals(workouts: WorkoutMeta[], month: Date): MonthTotals {
  const y = month.getFullYear();
  const m = month.getMonth();
  const inMonth = workouts.filter((w) => {
    const d = new Date(w.startedAt);
    return d.getFullYear() === y && d.getMonth() === m;
  });
  return inMonth.reduce<MonthTotals>(
    (acc, w) => ({
      count: acc.count + 1,
      distanceM: acc.distanceM + w.summary.distanceM,
      durationSec: acc.durationSec + w.summary.durationMovingSec,
    }),
    { count: 0, distanceM: 0, durationSec: 0 },
  );
}

/** SVG polyline path from a downsampled [lat,lng] route, fit into a square. */
export function routePreviewPath(
  points: [number, number][],
  size = 44,
  pad = 5,
): string | null {
  if (!points || points.length < 2) return null;
  const lats = points.map((p) => p[0]);
  const lngs = points.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1e-6;
  const spanLng = maxLng - minLng || 1e-6;
  const inner = size - pad * 2;
  const scale = Math.min(inner / spanLat, inner / spanLng);
  const offX = pad + (inner - spanLng * scale) / 2;
  const offY = pad + (inner - spanLat * scale) / 2;
  const coords = points.map(([lat, lng]) => {
    const x = offX + (lng - minLng) * scale;
    const y = offY + (maxLat - lat) * scale; // flip so north is up
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return coords.join(' ');
}

/** Watch-recorded/imported vs phone-GPS-recorded, from the existing `source`
 * field: RecordingEngine (phone) always writes 'manual'; every importer
 * (Health Connect, Samsung Health, HealthKit) means the session came off a
 * paired watch. No new field needed — see workout.ts WorkoutSource. */
export function isWatchRecorded(source: WorkoutMeta['source']): boolean {
  return source !== 'manual';
}
