import { Capacitor } from '@capacitor/core';
import { db } from '@/db/db';
import type { IntervalPlan } from '@/model/intervalPlan';
import { planUpdatedAt } from '@/model/intervalPlan';
import { WearBridge } from '@/plugins/wearHr';

/**
 * Last-writer-wins merge: which of `local`/`remote` should end up stored, given
 * their `updatedAt` (defaulting to `createdAt`). Ties keep `local`. Pure function
 * so it's independently checkable — see scripts/check-plan-merge.ts.
 */
export function mergePlan(
  local: IntervalPlan | undefined,
  remote: IntervalPlan,
): IntervalPlan {
  if (!local) return remote;
  return planUpdatedAt(remote) > planUpdatedAt(local) ? remote : local;
}

async function pushPlan(plan: IntervalPlan): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WearBridge.putPlan({ json: JSON.stringify(plan) });
  } catch {
    // best-effort; watch may be unreachable
  }
}

/** Push a single locally-saved/deleted plan to the watch. Never throws. */
export async function pushOnePlan(plan: IntervalPlan): Promise<void> {
  await pushPlan(plan);
}

/** Merge one incoming plan (from the native 'planChanged' event) into Dexie. */
export async function mergeIncomingPlan(json: string): Promise<void> {
  try {
    const remote = JSON.parse(json) as IntervalPlan;
    const local = await db.plans.get(remote.id);
    const winner = mergePlan(local, remote);
    if (winner !== local) await db.plans.put(winner);
  } catch {
    // ignore malformed payloads
  }
}

/**
 * Pull every plan currently on the watch, merge LWW into Dexie, then push any
 * local plan (including tombstones) that's newer than or missing from the
 * remote set. No-op on web; never throws into the UI.
 */
export async function syncPlans(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const res = (await WearBridge.getAllPlans()) ?? { plans: [] };

    const remotePlans = res.plans
      .map((j) => {
        try {
          return JSON.parse(j) as IntervalPlan;
        } catch {
          return null;
        }
      })
      .filter((p): p is IntervalPlan => !!p);
    const remoteById = new Map(remotePlans.map((p) => [p.id, p]));

    for (const remote of remotePlans) {
      const local = await db.plans.get(remote.id);
      const winner = mergePlan(local, remote);
      if (winner !== local) await db.plans.put(winner);
    }

    const locals = await db.plans.toArray();
    for (const local of locals) {
      const remote = remoteById.get(local.id);
      if (!remote || planUpdatedAt(local) > planUpdatedAt(remote)) {
        await pushPlan(local);
      }
    }
  } catch {
    // best-effort; sync failures must never break the UI
  }
}
