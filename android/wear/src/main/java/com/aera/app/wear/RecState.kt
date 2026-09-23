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
    @Volatile var paceSecPerKm: Int = 0
    @Volatile var stepFraction: Float = 0f
    @Volatile var stepRemainingM: Int = 0
    @Volatile var stepTargetM: Int = 0
    @Volatile var stepKindIndex: Int = 1
    @Volatile var stepKindTotal: Int = 1
    @Volatile var nextStepLabel: String = ""

    /** F8 lap card: last completed lap, shown by LiveScreen while now - lastLapAtMs < 3000. */
    data class LapInfo(
        val n: Int,
        val label: String,
        val lapSec: Int,
        val deltaSec: Int?,
        val distanceM: Double,
        val avgHr: Int,
        val trigger: String,
    )
    @Volatile var lastLap: LapInfo? = null
    @Volatile var lastLapAtMs: Long = 0L

    /** F7 summary, published once ExerciseService finishes and saves. */
    @Volatile var summaryReady: Boolean = false
    @Volatile var sumWorkoutId: String = ""
    @Volatile var sumDistanceM: Double = 0.0
    @Volatile var sumDurationSec: Int = 0
    @Volatile var sumAvgPaceSecPerKm: Int = 0
    @Volatile var sumAvgHr: Int = 0
    @Volatile var sumZoneSecs: IntArray = IntArray(5)

    /** Phase 5 will drive this from the real DataClient upload; for now it just starts pending. */
    @Volatile var syncState: String = "pending" // pending | syncing | synced

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
        paceSecPerKm = 0
        stepFraction = 0f
        stepRemainingM = 0
        stepTargetM = 0
        stepKindIndex = 1
        stepKindTotal = 1
        nextStepLabel = ""
        lastLap = null
        lastLapAtMs = 0L
        summaryReady = false
        sumWorkoutId = ""
        sumDistanceM = 0.0
        sumDurationSec = 0
        sumAvgPaceSecPerKm = 0
        sumAvgHr = 0
        sumZoneSecs = IntArray(5)
        syncState = "pending"
    }
}
