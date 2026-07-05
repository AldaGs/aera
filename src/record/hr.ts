import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { WearBridge } from '@/plugins/wearHr';

/** A live HR source: read the latest bpm, and stop it when recording ends. */
export interface WatchHr {
  connected: boolean;
  latest: () => number | null;
  stop: () => Promise<void>;
}

const OFF: WatchHr = { connected: false, latest: () => null, stop: async () => {} };

/**
 * Start listening for live HR from the Wear OS companion. No-op off-device or when
 * no watch is reachable — the recorder simply records without HR. The returned
 * `latest()` is what you wire into `RecordingEngine.hrProvider`. HR arrives ~1/s
 * and goes stale if the watch drops off, so samples older than ~8 s read as null.
 */
export async function startWatchHr(): Promise<WatchHr> {
  if (!Capacitor.isNativePlatform()) return OFF;
  try {
    const { connected } = await WearBridge.isWatchConnected();
    if (!connected) return OFF;

    let bpm: number | null = null;
    let lastAt = 0;
    const handle: PluginListenerHandle = await WearBridge.addListener('hr', (e) => {
      bpm = e.bpm;
      lastAt = Date.now();
    });

    return {
      connected: true,
      latest: () => (Date.now() - lastAt < 8000 ? bpm : null),
      stop: async () => {
        await handle.remove();
        try {
          await WearBridge.stopWatch();
        } catch {
          // watch already gone — nothing to stop
        }
      },
    };
  } catch {
    return OFF;
  }
}
