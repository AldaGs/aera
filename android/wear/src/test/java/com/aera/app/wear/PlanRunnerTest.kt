package com.aera.app.wear

import org.json.JSONArray
import org.json.JSONObject
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

    @Test
    fun kindIndexAndTotalMatchLabelCounts() {
        val steps = PlanRunner.flatten(null, StepTarget("time", sec = 30), StepTarget("time", sec = 15), 3, null)
        // work,recovery,work,recovery,work,recovery
        assertEquals(1 to 3, steps[0].kindIndex to steps[0].kindTotal)
        assertEquals(2 to 3, steps[2].kindIndex to steps[2].kindTotal)
        assertEquals(3 to 3, steps[4].kindIndex to steps[4].kindTotal)
    }

    @Test
    fun stepFractionTracksTimeTarget() {
        val steps = PlanRunner.flatten(null, StepTarget("time", sec = 100), null, 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertEquals(0f, r.stepFraction(0, 0.0))
        assertEquals(0.5f, r.stepFraction(50_000, 0.0))
        assertEquals(1f, r.stepFraction(150_000, 0.0)) // coerced at 1
    }

    @Test
    fun stepFractionTracksDistanceTarget() {
        val steps = PlanRunner.flatten(null, StepTarget("distance", m = 1000), null, 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertEquals(0.4f, r.stepFraction(0, 400.0))
    }

    @Test
    fun remainingMCountsDownToZero() {
        val steps = PlanRunner.flatten(null, StepTarget("distance", m = 800), null, 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertEquals(600, r.remainingM(200.0))
        assertEquals(0, r.remainingM(999.0))
    }

    @Test
    fun nextStepLabelReflectsUpcomingStepAndIsNullAtEnd() {
        val steps = PlanRunner.flatten(StepTarget("time", sec = 10), StepTarget("time", sec = 10), StepTarget("time", sec = 5), 1, null)
        val r = PlanRunner(steps, autoFinish = true)
        assertEquals("Work 1/1", r.nextStepLabel()) // from warmup, next is work ("work" always carries i/n)
        r.next(1000, 0.0) // -> work
        assertEquals("Recovery", r.nextStepLabel())
        r.next(2000, 0.0) // -> recovery (last step)
        assertEquals(null, r.nextStepLabel())
    }

    private fun stepDef(kind: String, type: String, sec: Int = 0, m: Int = 0): JSONObject =
        JSONObject().put("kind", kind).put(
            "target",
            JSONObject().put("type", type).also {
                if (sec != 0) it.put("sec", sec)
                if (m != 0) it.put("m", m)
            },
        )

    @Test
    fun fromJsonReadsNewShapeMixedKindLabels() {
        // warmup, walk, run, walk, run, recovery — mirrors the README sample plan.
        val steps = JSONArray()
            .put(stepDef("warmup", "time", sec = 300))
            .put(stepDef("walk", "time", sec = 120))
            .put(stepDef("run", "distance", m = 1000))
            .put(stepDef("walk", "time", sec = 120))
            .put(stepDef("run", "distance", m = 1500))
            .put(stepDef("recovery", "time", sec = 300))
        val plan = JSONObject().put("steps", steps).put("autoFinish", true)
        val (flat, autoFinish) = PlanRunner.fromJson(plan)
        assertTrue(autoFinish)
        assertEquals(listOf("warmup", "walk", "run", "walk", "run", "recovery"), flat.map { it.kind })
        assertEquals("Warm-up", flat[0].label) // count 1 -> bare name
        assertEquals("Walk 1/2", flat[1].label)
        assertEquals("Run 1/2", flat[2].label)
        assertEquals("Walk 2/2", flat[3].label)
        assertEquals("Run 2/2", flat[4].label)
        assertEquals("Recovery", flat[5].label)
    }

    @Test
    fun fromJsonExpandsRepeatBlock() {
        val inner = JSONArray()
            .put(stepDef("work", "time", sec = 30))
            .put(stepDef("recovery", "time", sec = 15))
        val block = JSONObject().put("repeat", 3).put("steps", inner)
        val steps = JSONArray().put(block)
        val plan = JSONObject().put("steps", steps).put("autoFinish", false)
        val (flat, autoFinish) = PlanRunner.fromJson(plan)
        assertFalse(autoFinish)
        assertEquals(listOf("work", "recovery", "work", "recovery", "work", "recovery"), flat.map { it.kind })
        assertEquals("Work 1/3", flat[0].label)
        assertEquals("Work 3/3", flat[4].label)
        assertEquals("Recovery 3/3", flat[5].label)
    }

    @Test
    fun fromJsonFallsBackToLegacyShape() {
        val plan = JSONObject()
            .put("warmup", JSONObject().put("type", "time").put("sec", 60))
            .put("work", JSONObject().put("type", "time").put("sec", 30))
            .put("recovery", JSONObject().put("type", "time").put("sec", 15))
            .put("repeats", 2)
            .put("cooldown", JSONObject().put("type", "time").put("sec", 60))
        val (flat, autoFinish) = PlanRunner.fromJson(plan)
        assertTrue(autoFinish) // default when absent
        assertEquals(listOf("warmup", "work", "recovery", "work", "recovery", "cooldown"), flat.map { it.kind })
        assertEquals("Work 1/2", flat[1].label)
        assertEquals("Recovery 2/2", flat[4].label)
    }
}
