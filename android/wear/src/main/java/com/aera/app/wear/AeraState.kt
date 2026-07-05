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

    fun setStep(label: String, kind: String, remainingSec: Int) {
        stepLabel = label
        stepKind = kind
        stepRemainingSec = remainingSec
        stepReceivedAt = System.currentTimeMillis()
    }

    fun clearStep() {
        stepLabel = ""
        stepKind = ""
        stepRemainingSec = 0
        stepReceivedAt = 0L
    }

    /** Seconds left in the current step, counted down since it was received. */
    fun remainingNow(): Int {
        if (stepReceivedAt == 0L) return 0
        val elapsed = ((System.currentTimeMillis() - stepReceivedAt) / 1000).toInt()
        return (stepRemainingSec - elapsed).coerceAtLeast(0)
    }
}
