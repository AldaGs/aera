package com.aera.app.wear

/**
 * HR-zone math shared by the live layouts (1h arc, 1i mini meter). Mirrors
 * `hrZoneIndex` in src/metrics/deriveSummary.ts: Z1<60%, Z2<70%, Z3<80%, Z4<90%, Z5>=90% of max HR.
 *
 * ponytail: max HR is a fixed default (no per-user setting synced from the phone yet) —
 * wire a real value from AeraState/phone sync if/when that lands.
 */
object Zones {
    const val DEFAULT_MAX_HR = 190

    val names = listOf("Easy", "Endurance", "Tempo", "Threshold", "Max")

    fun index(hr: Int, maxHr: Int = DEFAULT_MAX_HR): Int {
        if (maxHr <= 0) return 0
        val pct = hr.toFloat() / maxHr
        return when {
            pct < 0.6f -> 0
            pct < 0.7f -> 1
            pct < 0.8f -> 2
            pct < 0.9f -> 3
            else -> 4
        }
    }

    fun name(hr: Int, maxHr: Int = DEFAULT_MAX_HR): String = names[index(hr, maxHr)]

    /** Angle (degrees) along the 1h arc (150°..390°, i.e. 240° sweep) for a marker at this HR. */
    fun markerAngleDeg(hr: Int, maxHr: Int = DEFAULT_MAX_HR): Float {
        if (maxHr <= 0) return 150f
        val pct = (hr.toFloat() / maxHr).coerceIn(0f, 1f)
        return 150f + 240f * pct
    }
}
