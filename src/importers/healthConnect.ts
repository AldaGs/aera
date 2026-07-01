import { Capacitor } from '@capacitor/core';
import { Health, type HealthPermission } from 'capacitor-health';
import type { Workout } from '@/model/workout';
import { existingExternalIds, saveWorkout } from '@/db/db';
import { effectiveMaxHr, loadProfile } from '@/store/profile';
import { externalKey, mapHealthWorkout, type HealthWorkout } from './mapWorkout';

// Read permissions we need for run/ride sessions with route + HR.
const READ_PERMISSIONS: HealthPermission[] = [
  'READ_WORKOUTS',
  'READ_ROUTE',
  'READ_HEART_RATE',
];

export interface ImportResult {
  imported: number;
  skipped: number; // duplicates or unsupported sports
  total: number; // sessions returned by the platform
}

/** True only inside a real native Android/iOS build — web has no Health Connect. */
export function healthAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function requestHealthAccess(): Promise<boolean> {
  const { available } = await Health.isHealthAvailable();
  if (!available) return false;
  await Health.requestHealthPermissions({ permissions: READ_PERMISSIONS });
  return true;
}

/**
 * Pull workouts from Health Connect over the last `days`, map to normalized
 * Workouts, dedup against what's already stored, and persist. Returns counts.
 */
export async function importFromHealthConnect(days = 90): Promise<ImportResult> {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 86400000);

  const res = await Health.queryWorkouts({
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    includeHeartRate: true,
    includeRoute: true,
    includeSteps: false,
  });

  const raw = (res.workouts ?? []) as unknown as HealthWorkout[];
  const seen = await existingExternalIds();

  const maxHr = effectiveMaxHr(loadProfile());

  let imported = 0;
  let skipped = 0;
  for (const hw of raw) {
    const key = externalKey(hw);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    const mapped: Workout | null = mapHealthWorkout(hw, { athleteId: 'me', maxHr });
    if (!mapped) {
      skipped++;
      continue;
    }
    await saveWorkout(mapped);
    seen.add(key);
    imported++;
  }

  return { imported, skipped, total: raw.length };
}
