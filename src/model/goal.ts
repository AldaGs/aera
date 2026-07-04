import type { Sport } from './workout';

/**
 * A user training goal. Progress is computed on the fly from workout history by
 * `computeGoalProgress` (src/metrics/goals.ts) — nothing here is cached.
 */
export type GoalMetric =
  | 'distance' // total distance over the window (m)
  | 'continuous-distance' // longest single uninterrupted effort (m)
  | 'frequency' // number of activities in the window
  | 'duration' // total moving time (sec)
  | 'pace'; // achieve an avg pace at/under target on a single run (sec/km)

export interface Goal {
  id: string;
  title: string;
  sport: Sport | null; // null = any sport
  metric: GoalMetric;
  target: number; // meters / count / seconds / sec-per-km depending on metric
  deadline: string | null; // ISO date; also bounds the window for windowed metrics
  createdAt: string; // ISO
  doneAt: string | null; // ISO when first completed
}
