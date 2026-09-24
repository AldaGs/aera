package com.aera.app.wear

/** in/high/low relative to the target zone, or none while there's no target/reading. */
enum class ZoneStatus { IN, HIGH, LOW, NONE }

/** Alert to fire on a `sample()` call, or null. */
enum class ZoneEvent { HIGH, LOW, BACK }

private const val OUT_OF_ZONE_ALERT_MS = 15_000L
private const val REPEAT_ALERT_MS = 60_000L

/**
 * Watch-side mirror of src/record/zoneGuard.ts — same state machine, same thresholds.
 * Pure Kotlin, no Android deps, so it's unit-testable like PlanRunner.
 */
class ZoneGuard {
    var status: ZoneStatus = ZoneStatus.NONE
        private set
    private var outSinceMs: Long? = null
    private var lastAlertMs: Long? = null
    private var alerted = false
    private var outSide: ZoneStatus? = null // HIGH or LOW of the current streak

    fun reset() {
        status = ZoneStatus.NONE
        outSinceMs = null
        lastAlertMs = null
        alerted = false
        outSide = null
    }

    /** targetZone: 1..5, or null/0 for "no target". */
    fun sample(nowMs: Long, hr: Int, targetZone: Int?, maxHr: Int, paused: Boolean = false): ZoneEvent? {
        if (paused) {
            // Pause time must not count as out-of-zone time (resume would alert at once).
            outSinceMs = null
            outSide = null
            return null
        }
        if (hr <= 0 || targetZone == null || targetZone <= 0 || maxHr <= 0) return null

        val zoneIdx = Zones.index(hr, maxHr) // 0-based
        val s = when {
            zoneIdx + 1 == targetZone -> ZoneStatus.IN
            zoneIdx + 1 > targetZone -> ZoneStatus.HIGH
            else -> ZoneStatus.LOW
        }
        status = s

        if (s == ZoneStatus.IN) {
            val wasAlerted = alerted
            outSinceMs = null
            alerted = false
            return if (wasAlerted) ZoneEvent.BACK else null
        }

        // New streak, or flipped high<->low: restart the 15 s wait; the other side's
        // repeat window doesn't apply (it's a different instruction).
        if (outSinceMs == null || outSide != s) {
            if (outSide != null && outSide != s) lastAlertMs = null
            outSinceMs = nowMs
            outSide = s
        }
        val outFor = nowMs - outSinceMs!!
        if (outFor < OUT_OF_ZONE_ALERT_MS) return null
        val last = lastAlertMs
        if (last != null && nowMs - last < REPEAT_ALERT_MS) return null

        lastAlertMs = nowMs
        alerted = true
        return if (s == ZoneStatus.HIGH) ZoneEvent.HIGH else ZoneEvent.LOW
    }
}
