package com.aera.app.wear

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RunMathTest {
    @Test
    fun avgPaceComputesSecPerKm() {
        // 5 km in 25 min -> 5:00/km.
        assertEquals(300, RunMath.avgPaceSecPerKm(5000.0, 1500))
    }

    @Test
    fun avgPaceIsZeroWithoutDistanceOrTime() {
        assertEquals(0, RunMath.avgPaceSecPerKm(0.0, 600))
        assertEquals(0, RunMath.avgPaceSecPerKm(1000.0, 0))
    }

    @Test
    fun lapDeltaIsNullForFirstLap() {
        assertNull(RunMath.lapDeltaSec(300, null))
    }

    @Test
    fun lapDeltaIsDifferenceFromPreviousLap() {
        assertEquals(-6, RunMath.lapDeltaSec(302, 308))
        assertEquals(6, RunMath.lapDeltaSec(308, 302))
    }
}

class ZonesAccumulationTest {
    @Test
    fun zoneSecondsAttributesRectangleRuleFromLastKnownHr() {
        val maxHr = 190
        // Each interval is attributed to the zone of the sample that ends it (trailing edge):
        // 0->10s ends at hr=140 (73.7%, Z3), 10->40s stays at hr=140 (Z3).
        val samples = listOf(0L to 100, 10_000L to 140, 40_000L to 140)
        val secs = Zones.zoneSeconds(samples, maxHr)
        assertEquals(40, secs[2])
        assertEquals(0, secs[0] + secs[1] + secs[3] + secs[4])
    }

    @Test
    fun zoneSecondsHoldsLastHrThroughAZeroReading() {
        val samples = listOf(0L to 150, 5_000L to 0, 15_000L to 150)
        val secs = Zones.zoneSeconds(samples, 190)
        // hr=150 -> 78.9% -> Z3 (index 2); the 0 reading doesn't reset the running total.
        assertEquals(15, secs[2])
    }

    @Test
    fun zoneSecondsIsZeroForFewerThanTwoSamples() {
        assertArrayEquals(IntArray(5), Zones.zoneSeconds(emptyList()))
        assertArrayEquals(IntArray(5), Zones.zoneSeconds(listOf(0L to 150)))
    }
}
