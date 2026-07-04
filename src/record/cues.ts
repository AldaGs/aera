import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import type { StepKind } from '@/model/intervalPlan';

/** A transition cue kind — the step you're entering, or 'done' at plan end. */
export type CueKind = StepKind | 'done';

/**
 * Fire a transition cue. Phone haptics via @capacitor/haptics, with a distinct
 * pattern per phase so it's legible in a pocket. No-op on web (haptics unavailable).
 *
 * Watch haptics is a future second sink: once the Wear OS companion exists, it
 * would receive a `/aera/cue` Data-Layer message here and buzz the watch too.
 */
export async function fireCue(kind: CueKind): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    switch (kind) {
      case 'work':
        // Entering effort — assertive double heavy buzz.
        await Haptics.impact({ style: ImpactStyle.Heavy });
        await delay(120);
        await Haptics.impact({ style: ImpactStyle.Heavy });
        break;
      case 'recovery':
        // Ease off — single light tap.
        await Haptics.impact({ style: ImpactStyle.Light });
        break;
      case 'warmup':
      case 'cooldown':
        await Haptics.impact({ style: ImpactStyle.Medium });
        break;
      case 'done':
        // Finished — long success notification.
        await Haptics.notification({ type: NotificationType.Success });
        break;
    }
  } catch {
    // Haptics unavailable on this device — silently ignore.
  }
  // TODO(watch companion): forward `kind` to the Wear OS app via the Data Layer.
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
