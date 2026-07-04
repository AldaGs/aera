import type { WorkoutMeta } from '@/db/db';
import {
  startOfWeek,
  weekDistanceM,
  activeWeekStreak,
  weekdayCounts,
} from './aggregate';
import { fmtDistance } from '@/format';

export type InsightTone = 'good' | 'warn' | 'info';

/** A generated insight card. `icon` is a lucide icon name the UI maps. */
export interface Insight {
  id: string;
  icon: string;
  title: string;
  body: string;
  tone: InsightTone;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Derive a small ranked set of insight cards from workout history. Pure over the
 * cached summaries — cheap enough to run on every render.
 */
export function computeInsights(workouts: WorkoutMeta[]): Insight[] {
  const out: Insight[] = [];
  if (workouts.length === 0) return out;

  const thisWeekStart = startOfWeek(new Date());
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);

  const thisWk = weekDistanceM(workouts, thisWeekStart);
  const lastWk = weekDistanceM(workouts, lastWeekStart);

  // Weekly volume trend.
  if (lastWk > 0) {
    const delta = (thisWk - lastWk) / lastWk;
    if (Math.abs(delta) >= 0.1) {
      const up = delta > 0;
      out.push({
        id: 'volume-trend',
        icon: up ? 'trending-up' : 'trending-down',
        title: up ? 'Volume climbing' : 'Volume easing off',
        body: `${fmtDistance(thisWk)} this week vs ${fmtDistance(lastWk)} last week (${
          up ? '+' : ''
        }${Math.round(delta * 100)}%).`,
        tone: up ? 'good' : 'info',
      });
    }
  } else if (thisWk > 0) {
    out.push({
      id: 'volume-start',
      icon: 'trending-up',
      title: 'Back at it',
      body: `${fmtDistance(thisWk)} logged so far this week.`,
      tone: 'good',
    });
  }

  // Consistency streak.
  const streak = activeWeekStreak(workouts);
  if (streak >= 2) {
    out.push({
      id: 'streak',
      icon: 'flame',
      title: `${streak}-week streak`,
      body: `You've trained every week for ${streak} weeks running. Keep it rolling.`,
      tone: 'good',
    });
  }

  // Training-load trend (needs HR-derived load).
  const loadThis = sumLoad(workouts, thisWeekStart);
  const loadLast = sumLoad(workouts, lastWeekStart, thisWeekStart);
  if (loadThis > 0 && loadLast > 0 && loadThis / loadLast >= 1.5) {
    out.push({
      id: 'load-spike',
      icon: 'activity',
      title: 'Big load jump',
      body: `Training load is up ${Math.round(
        (loadThis / loadLast - 1) * 100,
      )}% on last week — watch recovery to stay injury-free.`,
      tone: 'warn',
    });
  }

  // Favourite training day.
  const counts = weekdayCounts(workouts);
  const maxCount = Math.max(...counts);
  if (workouts.length >= 5 && maxCount >= 2) {
    const day = counts.indexOf(maxCount);
    out.push({
      id: 'fav-day',
      icon: 'calendar',
      title: `${WEEKDAYS[day]} is your day`,
      body: `Most of your activities land on ${WEEKDAYS[day]}.`,
      tone: 'info',
    });
  }

  // Longest continuous effort highlight.
  const longest = workouts.reduce(
    (best, w) =>
      (w.summary.longestContinuousM ?? 0) > (best?.summary.longestContinuousM ?? 0)
        ? w
        : best,
    undefined as WorkoutMeta | undefined,
  );
  if (longest && (longest.summary.longestContinuousM ?? 0) >= 1000) {
    out.push({
      id: 'longest-continuous',
      icon: 'route',
      title: 'Longest unbroken effort',
      body: `${fmtDistance(
        longest.summary.longestContinuousM ?? 0,
      )} without stopping — that's your best continuous stretch.`,
      tone: 'good',
    });
  }

  return out;
}

function sumLoad(workouts: WorkoutMeta[], from: Date, before?: Date): number {
  const lo = from.getTime();
  const hi = before ? before.getTime() : lo + 7 * 86400000;
  return workouts
    .filter((w) => {
      const t = new Date(w.startedAt).getTime();
      return t >= lo && t < hi;
    })
    .reduce((a, w) => a + (w.summary.trainingLoad ?? 0), 0);
}
