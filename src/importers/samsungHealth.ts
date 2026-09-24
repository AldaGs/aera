import { Capacitor } from '@capacitor/core';
import type { Workout } from '@/model/workout';
import { importedWorkoutsByExternalId, saveWorkout } from '@/db/db';
import { effectiveMaxHr, loadProfile } from '@/store/profile';
import { SamsungHealth } from '@/plugins/samsungHealth';
import { externalKey, mapHealthWorkout } from './mapWorkout';

export interface ImportResult {
  imported: number;
  upgraded: number; // existing summary-only workouts replaced with a routed version
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
  const { granted } = await SamsungHealth.requestHealthPermissions();
  return granted;
}

/**
 * Read workouts from Samsung Health directly (bypassing Health Connect), map to
 * normalized Workouts, dedup, and persist.
 */
export async function importFromSamsungHealth(days = 90): Promise<ImportResult> {
  // Read one week at a time: a single 90-day read (full routes + HR logs) is too
  // big for one bridge message and crashed the app with OutOfMemoryError.
  // ponytail: a single huge week (ultra runs) could still be heavy; page per-session if so.
  const raw: Awaited<ReturnType<typeof SamsungHealth.readWorkouts>>['workouts'] = [];
  for (let to = 0; to < days; to += 7) {
    const { workouts } = await SamsungHealth.readWorkouts({ days: Math.min(to + 7, days), toDaysAgo: to });
    raw.push(...workouts);
  }
  const existing = await importedWorkoutsByExternalId();
  const profile = loadProfile();
  const maxHr = effectiveMaxHr(profile);

  let imported = 0;
  let upgraded = 0;
  let skippedDup = 0;
  let skippedUnsupported = 0;
  let withRoute = 0;
  const types: Record<string, number> = {};

  for (const hw of raw) {
    const typeKey = String(hw.workoutType ?? 'unknown');
    types[typeKey] = (types[typeKey] ?? 0) + 1;
    const hasRoute = (hw.route?.length ?? 0) > 0;
    if (hasRoute) withRoute++;

    const key = externalKey(hw);
    const prior = existing.get(key);

    const mapped: Workout | null = mapHealthWorkout(hw, {
      athleteId: 'me',
      maxHr,
      restingHr: profile.restingHr,
      weightKg: profile.weightKg,
    });
    if (!mapped) {
      skippedUnsupported++;
      continue;
    }
    // Samsung 'source' distinguishes it from the Health Connect path.
    mapped.source = 'samsung-health';

    // Already stored: re-import (upgrade in place) when a route was newly added
    // OR the corrected metrics differ materially from what we stored (e.g. a
    // partial-GPS run whose watch distance we now trust). Otherwise skip as dup.
    if (prior) {
      const priorHasRoute = prior.summary.bounds != null;
      const routeAdded = hasRoute && !priorHasRoute;
      const distDelta = Math.abs(mapped.summary.distanceM - prior.summary.distanceM);
      const metricsChanged = distDelta > Math.max(50, prior.summary.distanceM * 0.02);
      if (!routeAdded && !metricsChanged) {
        skippedDup++;
        continue;
      }
      // Reuse the row id and keep the user's text layer (title/notes).
      mapped.id = prior.id;
      if (prior.title) mapped.title = prior.title;
      if (prior.notes) mapped.notes = prior.notes;
      upgraded++;
    } else {
      imported++;
    }
    await saveWorkout(mapped);
    const { track: _track, ...meta } = mapped;
    existing.set(key, meta);
  }

  return {
    imported,
    upgraded,
    skippedDup,
    skippedUnsupported,
    total: raw.length,
    withRoute,
    types,
  };
}
