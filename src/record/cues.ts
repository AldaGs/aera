import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { WearBridge } from '@/plugins/wearHr';
import type { StepKind } from '@/model/intervalPlan';

/** A transition cue kind — the step you're entering, 'done' at plan end, or an HR
 * zone-guard event (see src/record/zoneGuard.ts). */
export type CueKind = StepKind | 'done' | 'zone-high' | 'zone-low' | 'zone-back';

/**
 * Fire a transition cue. Phone haptics via @capacitor/haptics, with a distinct
 * pattern per phase so it's legible in a pocket. No-op on web (haptics unavailable).
 *
 * Watch haptics is a future second sink: once the Wear OS companion exists, it
 * would receive a `/aera/cue` Data-Layer message here and buzz the watch too.
 */
export async function fireCue(kind: CueKind): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  // Buzz the watch too (no-op when no companion is connected).
  WearBridge.sendCue({ kind }).catch(() => {});
  try {
    switch (kind) {
      case 'work':
      case 'run':
        // Entering effort — assertive double heavy buzz.
        await Haptics.impact({ style: ImpactStyle.Heavy });
        await delay(120);
        await Haptics.impact({ style: ImpactStyle.Heavy });
        break;
      case 'recovery':
      case 'walk':
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
      case 'zone-high':
        // Slow down — two short heavy taps.
        await Haptics.impact({ style: ImpactStyle.Heavy });
        await delay(100);
        await Haptics.impact({ style: ImpactStyle.Heavy });
        break;
      case 'zone-low':
        // Speed up — one long buzz.
        await Haptics.vibrate({ duration: 400 });
        break;
      case 'zone-back':
        // Back in zone — one very short tick.
        await Haptics.impact({ style: ImpactStyle.Light });
        break;
    }
  } catch {
    // Haptics unavailable on this device — silently ignore.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
