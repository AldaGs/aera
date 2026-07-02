import { Capacitor } from '@capacitor/core';
import type { Workout } from '@/model/workout';
import { existingExternalIds, saveWorkout } from '@/db/db';
import { effectiveMaxHr, loadProfile } from '@/store/profile';
import { SamsungHealth } from '@/plugins/samsungHealth';
import { externalKey, mapHealthWorkout } from './mapWorkout';

export interface ImportResult {
  imported: number;
  skippedDup: number;
  skippedUnsupported: number;
  total: number;
  withRoute: number;
  types: Record<string, number>;
}

/** Available only inside the native Android build with the Samsung plugin. */
export function samsungAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function requestSamsungAccess(): Promise<boolean> {
  const { available } = await SamsungHealth.isAvailable();
  if (!available) return false;
  const { granted } = await SamsungHealth.requestPermissions();
  return granted;
}

/**
 * Read workouts from Samsung Health directly (bypassing Health Connect), map to
 * normalized Workouts, dedup, and persist.
 */
export async function importFromSamsungHealth(days = 90): Promise<ImportResult> {
  const { workouts: raw } = await SamsungHealth.readWorkouts({ days });
  const seen = await existingExternalIds();
  const maxHr = effectiveMaxHr(loadProfile());

  let imported = 0;
  let skippedDup = 0;
  let skippedUnsupported = 0;
  let withRoute = 0;
  const types: Record<string, number> = {};

  for (const hw of raw) {
    const typeKey = String(hw.workoutType ?? 'unknown');
    types[typeKey] = (types[typeKey] ?? 0) + 1;
    if ((hw.route?.length ?? 0) > 0) withRoute++;

    const key = externalKey(hw);
    if (seen.has(key)) {
      skippedDup++;
      continue;
    }
    const mapped: Workout | null = mapHealthWorkout(hw, { athleteId: 'me', maxHr });
    if (!mapped) {
      skippedUnsupported++;
      continue;
    }
    // Samsung 'source' distinguishes it from the Health Connect path.
    mapped.source = 'samsung-health';
    await saveWorkout(mapped);
    seen.add(key);
    imported++;
  }

  return { imported, skippedDup, skippedUnsupported, total: raw.length, withRoute, types };
}
