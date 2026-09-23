package com.aera.app.wear

/**
 * Live readout for a standalone ExerciseService recording, polled by RecordActivity
 * (same volatile-fields-+-poll pattern as AeraState for the phone-mirrored HR screen).
 */
object RecState {
    @Volatile var running: Boolean = false
    @Volatile var paused: Boolean = false
    @Volatile var autoPaused: Boolean = false
    @Volatile var elapsedSec: Int = 0
    @Volatile var distanceM: Double = 0.0
    @Volatile var hr: Int = 0
    @Volatile var stepLabel: String = ""
    @Volatile var stepKind: String = ""
    @Volatile var remainingSec: Int = 0
    @Volatile var stepIndex: Int = 0
    @Volatile var stepTotal: Int = 0
    @Volatile var complete: Boolean = false

    fun reset() {
        running = false
        paused = false
        autoPaused = false
        elapsedSec = 0
        distanceM = 0.0
        hr = 0
        stepLabel = ""
        stepKind = ""
        remainingSec = 0
        stepIndex = 0
        stepTotal = 0
        complete = false
    }
}
