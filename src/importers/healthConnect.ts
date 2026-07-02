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
  skippedDup: number; // already stored
  skippedUnsupported: number; // sport not run/ride
  total: number; // sessions returned by the platform
  withRoute: number; // sessions that had GPS route points
  types: Record<string, number>; // workoutType -> count
  granted: Record<string, boolean>; // permission -> granted
}

/** True only inside a real native Android/iOS build — web has no Health Connect. */
export function healthAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Read granted permissions, tolerating the shapes capacitor-health has used:
 * an array of {name: boolean} maps, a positional boolean array aligned to the
 * request, or a flat {name: boolean} object.
 */
async function grantedPermissions(): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  try {
    const res = (await Health.checkHealthPermissions({
      permissions: READ_PERMISSIONS,
    })) as { permissions?: unknown };
    const list = res.permissions;
    if (Array.isArray(list)) {
      list.forEach((entry, i) => {
        if (typeof entry === 'boolean') out[READ_PERMISSIONS[i]] = entry;
        else if (entry && typeof entry === 'object')
          for (const [k, v] of Object.entries(entry)) out[k] = Boolean(v);
      });
    } else if (list && typeof list === 'object') {
      for (const [k, v] of Object.entries(list)) out[k] = Boolean(v);
    }
  } catch {
    /* leave empty — surfaced as "unknown" in the UI */
  }
  return out;
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
    await saveWorkout(mapped);
    seen.add(key);
    imported++;
  }

  return {
    imported,
    skippedDup,
    skippedUnsupported,
    total: raw.length,
    withRoute,
    types,
    granted: await grantedPermissions(),
  };
}
