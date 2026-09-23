package com.aera.app.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class ZonesTest {
    @Test
    fun indexMatchesPhoneThresholds() {
        // Mirrors src/metrics/deriveSummary.ts hrZoneIndex: <60/<70/<80/<90/>=90% of max.
        assertEquals(0, Zones.index(100, maxHr = 190)) // 52.6%
        assertEquals(1, Zones.index(120, maxHr = 190)) // 63.2%
        assertEquals(2, Zones.index(140, maxHr = 190)) // 73.7%
        assertEquals(3, Zones.index(160, maxHr = 190)) // 84.2%
        assertEquals(4, Zones.index(180, maxHr = 190)) // 94.7%
    }

    @Test
    fun nameLooksUpZoneLabel() {
        assertEquals("Easy", Zones.name(100, maxHr = 190))
        assertEquals("Max", Zones.name(190, maxHr = 190))
    }

    @Test
    fun markerAngleSpansTheFullSweep() {
        assertEquals(150f, Zones.markerAngleDeg(0, maxHr = 190))
        assertEquals(390f, Zones.markerAngleDeg(190, maxHr = 190))
        assertEquals(270f, Zones.markerAngleDeg(95, maxHr = 190)) // 50% -> midpoint
    }

    @Test
    fun markerAngleClampsAboveMax() {
        assertEquals(390f, Zones.markerAngleDeg(250, maxHr = 190))
    }
}
