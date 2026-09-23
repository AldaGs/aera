package com.aera.app.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanRunnerTest {

    @Test
    fun flattenMatchesWarmupRepeatsCooldown() {
        val steps = PlanRunner.flatten(
            warmup = StepTarget("time", sec = 60),
            work = StepTarget("time", sec = 30),
            recovery = StepTarget("time", sec = 15),
            repeats = 2,
            cooldown = StepTarget("time", sec = 60),
        )
        assertEquals(listOf("warmup", "work", "recovery", "work", "recovery", "cooldown"), steps.map { it.kind })
        assertEquals("Work 1/2", steps[1].label)
        assertEquals("Recovery 2/2", steps[4].label)
    }

    @Test
    fun flattenSkipsNullSteps() {
        val steps = PlanRunner.flatten(null, StepTarget("time", sec = 30), null, 3, null)
        assertEquals(3, steps.size)
        assertTrue(steps.all { it.kind == "work" })
    }

    @Test
    fun advancesOnTime() {
        val steps = PlanRunner.flatten(null, StepTarget("time", sec = 10), null, 2, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertFalse(r.onUpdate(5000, 0.0))
        assertEquals(0, r.stepIndex)
        assertTrue(r.onUpdate(10000, 0.0))
        assertEquals(1, r.stepIndex)
        assertFalse(r.complete)
        assertTrue(r.onUpdate(20000, 0.0))
        assertTrue(r.complete)
    }

    @Test
    fun advancesOnDistance() {
        val steps = PlanRunner.flatten(null, StepTarget("distance", m = 400), null, 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertFalse(r.onUpdate(999_999, 399.0))
        assertTrue(r.onUpdate(999_999, 400.0))
        assertTrue(r.complete)
    }

    @Test
    fun eitherAdvancesOnWhicheverFirst() {
        val steps = PlanRunner.flatten(null, StepTarget("either", sec = 300, m = 1000), null, 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        // Distance reached well before time.
        assertTrue(r.onUpdate(60_000, 1000.0))
        assertTrue(r.complete)
    }

    @Test
    fun manualStepOnlyAdvancesViaNext() {
        val steps = PlanRunner.flatten(null, StepTarget("manual"), null, 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertFalse(r.onUpdate(999_999_999, 999_999.0))
        assertTrue(r.next(1000, 0.0))
        assertTrue(r.complete)
    }
}
