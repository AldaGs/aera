package com.aera.app.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Mirrors scripts/check-zone-guard.ts scenario-for-scenario. */
class ZoneGuardTest {
    private val maxHr = 190

    @Test
    fun highStreakAlertsAfter15sThenRepeatsAfter60s() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 150, 2, maxHr))
        assertEquals(ZoneStatus.HIGH, g.status)
        assertNull(g.sample(10_000, 150, 2, maxHr))
        assertEquals(ZoneEvent.HIGH, g.sample(15_000, 150, 2, maxHr))
        assertNull(g.sample(30_000, 150, 2, maxHr))
        assertEquals(ZoneEvent.HIGH, g.sample(75_000, 150, 2, maxHr))
        assertEquals(ZoneEvent.BACK, g.sample(80_000, 120, 2, maxHr))
        assertEquals(ZoneStatus.IN, g.status)
        assertNull(g.sample(85_000, 120, 2, maxHr))
    }

    @Test
    fun lowStreakAlerts() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 100, 2, maxHr))
        assertEquals(ZoneEvent.LOW, g.sample(15_000, 100, 2, maxHr))
    }

    @Test
    fun briefReturnResetsTheOutTimer() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 150, 2, maxHr))
        assertNull(g.sample(10_000, 120, 2, maxHr))
        assertNull(g.sample(20_000, 150, 2, maxHr))
        assertEquals(ZoneEvent.HIGH, g.sample(35_000, 150, 2, maxHr))
    }

    @Test
    fun pausedOrMissingInputsAreIgnored() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 150, 2, maxHr, paused = true))
        assertEquals(ZoneStatus.NONE, g.status)
        assertNull(g.sample(0, 0, 2, maxHr))
        assertNull(g.sample(0, 150, null, maxHr))
    }

    @Test
    fun resetOnStepChangeStartsAFreshStreak() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 150, 2, maxHr))
        g.reset()
        assertEquals(ZoneStatus.NONE, g.status)
        assertNull(g.sample(1000, 150, 2, maxHr))
        assertEquals(ZoneEvent.HIGH, g.sample(16_000, 150, 2, maxHr))
    }

    @Test
    fun pauseTimeDoesNotCountAsOutOfZone() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 150, 2, maxHr))
        assertNull(g.sample(10_000, 150, 2, maxHr, paused = true))
        assertNull(g.sample(40_000, 150, 2, maxHr))
        assertEquals(ZoneEvent.HIGH, g.sample(55_000, 150, 2, maxHr))
    }

    @Test
    fun flippingSidesRestartsTheWait() {
        val g = ZoneGuard()
        assertNull(g.sample(0, 150, 2, maxHr))
        assertEquals(ZoneEvent.HIGH, g.sample(15_000, 150, 2, maxHr))
        assertNull(g.sample(20_000, 100, 2, maxHr))
        assertEquals(ZoneEvent.LOW, g.sample(35_000, 100, 2, maxHr))
    }
}
