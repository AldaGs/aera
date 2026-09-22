import { Capacitor } from '@capacitor/core';
import { WearBridge } from '@/plugins/wearHr';

/** A live HR source: read the latest bpm, and stop it when recording ends. */
export interface WatchSensors {
  connected: boolean;
  latestHr: () => number | null;
  latestCadence: () => number | null;
  stop: () => Promise<void>;
}

const OFF: WatchSensors = { connected: false, latestHr: () => null, latestCadence: () => null, stop: async () => {} };

/**
 * Start listening for live HR from the Wear OS companion. No-op off-device or when
 * no watch is reachable — the recorder simply records without HR. The returned
 * `latest()` is what you wire into `RecordingEngine.hrProvider`. HR arrives ~1/s
 * and goes stale if the watch drops off, so samples older than ~8 s read as null.
 */
export async function startWatchSensors(): Promise<WatchSensors> {
  if (!Capacitor.isNativePlatform()) return OFF;
  try {
    const { connected } = await WearBridge.isWatchConnected();
    if (!connected) return OFF;

    let bpm: number | null = null;
    let cad: number | null = null;
    let lastHrAt = 0;
    let lastCadAt = 0;
    
    const handleHr = await WearBridge.addListener('hr', (e) => {
      bpm = e.bpm;
      lastHrAt = Date.now();
    });
    
    const handleCad = await WearBridge.addListener('cadence', (e) => {
      cad = e.cad;
      lastCadAt = Date.now();
    });

    return {
      connected: true,
      latestHr: () => (Date.now() - lastHrAt < 8000 ? bpm : null),
      latestCadence: () => (Date.now() - lastCadAt < 8000 ? cad : null),
      stop: async () => {
        await handleHr.remove();
        await handleCad.remove();
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
