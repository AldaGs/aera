import { hrZoneIndex } from '@/metrics/deriveSummary';
import type { HrZone } from '@/model/intervalPlan';

export type ZoneStatus = 'in' | 'high' | 'low' | 'none';
export type ZoneEvent = 'high' | 'low' | 'back';

const OUT_OF_ZONE_ALERT_MS = 15_000; // must be continuously out this long before alerting
const REPEAT_ALERT_MS = 60_000; // re-alert at most this often while still out

/**
 * Tracks whether the live HR is in/above/below a target zone and decides when to fire
 * an alert. Feed it a sample every tick (or call `reset()` on target/step change, or
 * while paused). Pure state machine — no timers, no I/O; call `sample()` with the
 * current wall-clock ms and current HR.
 */
export class ZoneGuard {
  private status: ZoneStatus = 'none';
  private outSinceMs: number | null = null; // when the current out-of-zone streak started
  private lastAlertMs: number | null = null; // last time an alert (high/low) fired
  private alerted = false; // an alert fired for the current out-of-zone streak (arms 'back')
  private outSide: ZoneStatus | null = null; // 'high' | 'low' of the current streak

  /** Current in/high/low/none status, for UI coloring. */
  getStatus(): ZoneStatus {
    return this.status;
  }

  /** Target/step changed (or paused/resumed): drop all timers and status. */
  reset(): void {
    this.status = 'none';
    this.outSinceMs = null;
    this.lastAlertMs = null;
    this.alerted = false;
    this.outSide = null;
  }

  /**
   * Feed one sample. `hr`/`targetZone` null, or `paused`, means "ignore" — timers hold
   * but nothing fires (caller should `reset()` on an actual step/target change).
   * Returns the event to fire, if any.
   */
  sample(nowMs: number, hr: number | null, targetZone: HrZone | null, maxHr: number | null, paused = false): ZoneEvent | null {
    if (paused) {
      // Pause time must not count as out-of-zone time (resume would alert at once).
      this.outSinceMs = null;
      this.outSide = null;
      return null;
    }
    if (!hr || !targetZone || !maxHr) return null;

    const zoneIdx = hrZoneIndex(hr, maxHr); // 0-based
    const status: ZoneStatus = zoneIdx + 1 === targetZone ? 'in' : zoneIdx + 1 > targetZone ? 'high' : 'low';
    this.status = status;

    if (status === 'in') {
      const wasAlerted = this.alerted;
      this.outSinceMs = null;
      this.alerted = false;
      if (wasAlerted) return 'back';
      return null;
    }

    // Out of zone (high or low).
    // New streak, or flipped high↔low: restart the 15 s wait; the other side's
    // repeat window doesn't apply (it's a different instruction).
    if (this.outSinceMs == null || this.outSide !== status) {
      if (this.outSide != null && this.outSide !== status) this.lastAlertMs = null;
      this.outSinceMs = nowMs;
      this.outSide = status;
    }
    const outFor = nowMs - this.outSinceMs;
    if (outFor < OUT_OF_ZONE_ALERT_MS) return null;
    if (this.lastAlertMs != null && nowMs - this.lastAlertMs < REPEAT_ALERT_MS) return null;

    this.lastAlertMs = nowMs;
    this.alerted = true;
    return status; // 'high' | 'low'
  }
}
