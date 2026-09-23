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

    /**
     * Accumulates seconds-in-zone from a chronological list of (elapsedMs, hr) samples, for the
     * F7 summary zone strip. Each sample's HR is attributed the seconds since the previous
     * sample (rectangle rule) — a hr==0 sample (no reading) contributes to whichever zone the
     * last-known reading was in, same as the live screens' "--" fallback never breaking the strip.
     *
     * ponytail: rectangle-rule attribution, not sample-rate weighted; fine at typical 1 Hz HR.
     */
    fun zoneSeconds(samples: List<Pair<Long, Int>>, maxHr: Int = DEFAULT_MAX_HR): IntArray {
        val secs = IntArray(5)
        if (samples.size < 2) return secs
        var lastHr = samples.first().second
        for (i in 1 until samples.size) {
            val (t, hr) = samples[i]
            val dt = ((t - samples[i - 1].first) / 1000).toInt().coerceAtLeast(0)
            if (hr > 0) lastHr = hr
            if (lastHr > 0) secs[index(lastHr, maxHr)] += dt
        }
        return secs
    }
}
