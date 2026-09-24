package com.aera.app.wear

/**
 * Tiny shared state between the HR service (writes bpm), the phone-message
 * listener (writes the current interval step) and the UI (reads both). Volatile
 * fields + a poll loop in the activity keep it dependency-free.
 */
object AeraState {
    @Volatile var hr: Int = 0
    @Volatile var measuring: Boolean = false

    @Volatile var stepLabel: String = ""
    @Volatile var stepKind: String = ""
    @Volatile private var stepRemainingSec: Int = 0
    @Volatile private var stepReceivedAt: Long = 0L
    /** Mirror-mode HR zone target: the phone stamps these onto /aera/step so this
     * screen can tint the HR readout the same way LiveRecorder does. 0 = no target. */
    @Volatile var targetZone: Int = 0
    @Volatile var maxHr: Int = Zones.DEFAULT_MAX_HR

    fun setStep(label: String, kind: String, remainingSec: Int, zone: Int = 0, maxHrArg: Int = 0) {
        stepLabel = label
        stepKind = kind
        stepRemainingSec = remainingSec
        stepReceivedAt = System.currentTimeMillis()
        targetZone = zone
        if (maxHrArg > 0) maxHr = maxHrArg
    }

    fun clearStep() {
        stepLabel = ""
        stepKind = ""
        stepRemainingSec = 0
        stepReceivedAt = 0L
        targetZone = 0
    }

    /** Seconds left in the current step, counted down since it was received. */
    fun remainingNow(): Int {
        if (stepReceivedAt == 0L) return 0
        val elapsed = ((System.currentTimeMillis() - stepReceivedAt) / 1000).toInt()
        return (stepRemainingSec - elapsed).coerceAtLeast(0)
    }
}
