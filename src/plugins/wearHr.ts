import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** One live heart-rate sample streamed from the watch companion. */
export interface HrEvent {
  bpm: number;
}

/**
 * Bridge to the native WearBridge plugin (Kotlin) that talks to the aera Wear OS
 * companion over the Wearable Data Layer. The watch streams HR to the phone; the
 * phone sends interval step / cue / stop messages back.
 */
export interface WearBridgePlugin {
  /** A paired watch node is currently reachable. */
  isWatchConnected(): Promise<{ connected: boolean }>;
  /** Mirror the current interval step to the watch UI. */
  sendStep(opts: { label: string; kind: string; remainingSec: number }): Promise<void>;
  /** Buzz the watch on a transition (matches the phone's fireCue kinds). */
  sendCue(opts: { kind: string }): Promise<void>;
  /** Tell the watch to stop measuring (run finished). */
  stopWatch(): Promise<void>;
  /** Subscribe to live HR samples pushed from the watch. */
  addListener(
    eventName: 'hr',
    listener: (event: HrEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const WearBridge = registerPlugin<WearBridgePlugin>('WearBridge');
