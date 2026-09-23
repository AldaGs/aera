package com.aera.app.wear

/** Small pure-Kotlin calcs shared by ExerciseService (F7 summary, F8 lap card). */
object RunMath {
    /** Average pace in sec/km, mirrors the live pace fallback: 0 when there's no distance. */
    fun avgPaceSecPerKm(distanceM: Double, durationSec: Int): Int {
        if (distanceM <= 0.0 || durationSec <= 0) return 0
        return (durationSec * 1000.0 / distanceM).toInt()
    }

    /** Lap N's delta vs lap N-1, in seconds; null for the first lap (nothing to compare). */
    fun lapDeltaSec(lapSec: Int, prevLapSec: Int?): Int? = prevLapSec?.let { lapSec - it }
}
