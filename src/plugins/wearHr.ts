import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** One live heart-rate sample streamed from the watch companion. */
export interface HrEvent {
  bpm: number;
}

export interface CadenceEvent {
  cad: number;
}

export interface CmdEvent {
  cmd: string;
}

export interface PlanChangedEvent {
  /** The changed plan, as JSON (matches the stored IntervalPlan shape). */
  json: string;
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
  /** Write/replace the DataItem for one interval plan (JSON string). */
  putPlan(opts: { json: string }): Promise<void>;
  /** Read every plan DataItem currently synced (each a JSON string). */
  getAllPlans(): Promise<{ plans: string[] }>;
  /** Subscribe to live HR samples pushed from the watch. */
  addListener(
    eventName: 'hr',
    listener: (event: HrEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'cadence',
    listener: (event: CadenceEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'cmd',
    listener: (event: CmdEvent) => void,
  ): Promise<PluginListenerHandle>;
  /** Fires when a plan DataItem changes (edited on watch, or synced in). */
  addListener(
    eventName: 'planChanged',
    listener: (event: PlanChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const WearBridge = registerPlugin<WearBridgePlugin>('WearBridge');
