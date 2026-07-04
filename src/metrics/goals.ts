import type { WorkoutMeta } from '@/db/db';
import type { Goal } from '@/model/goal';
import { fmtDistance, fmtDuration, fmtPace } from '@/format';

export interface GoalProgress {
  current: number;
  target: number;
  pct: number; // 0..1
  done: boolean;
  label: string; // human-readable "current / target"
  bestWorkoutId: string | null; // the workout that best contributes (single-effort metrics)
  daysLeft: number | null;
}

/** Cumulative metrics accumulate over time, so they only count activities from
 * when the goal was set. Achievement metrics reflect your best effort anytime. */
function isCumulative(metric: Goal['metric']): boolean {
  return metric === 'distance' || metric === 'frequency' || metric === 'duration';
}

/** Whether a workout counts toward a goal (sport + time window). */
function inScope(goal: Goal, w: WorkoutMeta): boolean {
  if (goal.sport && w.sport !== goal.sport) return false;
  const t = new Date(w.startedAt).getTime();
  // Cumulative goals only tally from the day they were set.
  if (isCumulative(goal.metric) && t < new Date(goal.createdAt).getTime()) return false;
  if (goal.deadline && t > endOfDay(goal.deadline)) return false;
  return true;
}

function endOfDay(iso: string): number {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function computeGoalProgress(
  goal: Goal,
  workouts: WorkoutMeta[],
): GoalProgress {
  const scoped = workouts.filter((w) => inScope(goal, w));
  let current = 0;
  let bestWorkoutId: string | null = null;

  switch (goal.metric) {
    case 'distance':
      current = scoped.reduce((a, w) => a + w.summary.distanceM, 0);
      break;
    case 'duration':
      current = scoped.reduce((a, w) => a + w.summary.durationMovingSec, 0);
      break;
    case 'frequency':
      current = scoped.length;
      break;
    case 'continuous-distance':
      for (const w of scoped) {
        const v = w.summary.longestContinuousM ?? 0;
        if (v > current) {
          current = v;
          bestWorkoutId = w.id;
        }
      }
      break;
    case 'pace': {
      // Best (lowest) avg pace on any single qualifying run; progress is how
      // close the best pace is to the target (100% when at/under target).
      let best = Infinity;
      for (const w of scoped) {
        const p = w.summary.avgPaceSecPerKm;
        if (p != null && p < best) {
          best = p;
          bestWorkoutId = w.id;
        }
      }
      current = Number.isFinite(best) ? best : 0;
      break;
    }
  }

  const done =
    goal.metric === 'pace'
      ? current > 0 && current <= goal.target
      : current >= goal.target;
  const pct =
    goal.metric === 'pace'
      ? current > 0
        ? Math.min(1, goal.target / current)
        : 0
      : Math.min(1, goal.target > 0 ? current / goal.target : 0);

  const daysLeft = goal.deadline
    ? Math.ceil((endOfDay(goal.deadline) - Date.now()) / 86400000)
    : null;

  return {
    current,
    target: goal.target,
    pct,
    done,
    label: goalLabel(goal, current),
    bestWorkoutId,
    daysLeft,
  };
}

function goalLabel(goal: Goal, current: number): string {
  switch (goal.metric) {
    case 'distance':
    case 'continuous-distance':
      return `${fmtDistance(current)} / ${fmtDistance(goal.target)}`;
    case 'duration':
      return `${fmtDuration(current)} / ${fmtDuration(goal.target)}`;
    case 'frequency':
      return `${current} / ${goal.target}`;
    case 'pace':
      return current > 0
        ? `${fmtPace(current)} (target ${fmtPace(goal.target)})`
        : `target ${fmtPace(goal.target)}`;
  }
}
