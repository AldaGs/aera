import { registerPlugin } from '@capacitor/core';
import type { HealthWorkout } from '@/importers/mapWorkout';

/**
 * Bridge to our custom native Samsung Health Data SDK plugin (Kotlin).
 * The native side returns workouts already shaped like `HealthWorkout` so they
 * flow through the same pure `mapHealthWorkout` mapper as the Health Connect
 * path — one normalization, two sources.
 */
export interface SamsungHealthPlugin {
  /** SDK present + Samsung Health installed. */
  isAvailable(): Promise<{ available: boolean }>;
  /** Show Samsung's permission UI; resolves with whether READ was granted. */
  requestHealthPermissions(): Promise<{ granted: boolean }>;
  /** Read exercise sessions (with route + HR) over the last `days`. */
  /** Workouts from `days` ago up to `toDaysAgo` ago (default now). */
  readWorkouts(options: { days: number; toDaysAgo?: number }): Promise<{ workouts: HealthWorkout[] }>;
}

export const SamsungHealth = registerPlugin<SamsungHealthPlugin>('SamsungHealth');
