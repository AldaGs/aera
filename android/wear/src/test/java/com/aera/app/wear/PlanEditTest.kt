package com.aera.app.wear

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlanEditTest {

    private val topLevelPlan = """
        {"id":"p1","name":"Test","sport":"run","autoFinish":true,"createdAt":"2026-01-01T00:00:00.000Z",
         "steps":[{"id":"s1","kind":"run","target":{"type":"distance","m":1000}}]}
    """.trimIndent()

    private val nestedPlan = """
        {"id":"p1","name":"Test","sport":"run","autoFinish":true,"createdAt":"2026-01-01T00:00:00.000Z",
         "steps":[
           {"id":"wu","kind":"warmup","target":{"type":"time","sec":60}},
           {"id":"rep","repeat":2,"steps":[{"id":"w1","kind":"run","target":{"type":"time","sec":30}}]}
         ]}
    """.trimIndent()

    @Test
    fun updateStepTargetReplacesTopLevelStep() {
        val newTarget = JSONObject().put("type", "time").put("sec", 120)
        val updated = JSONObject(PlanEdit.updateStepTarget(topLevelPlan, "s1", newTarget))
        val step = updated.getJSONArray("steps").getJSONObject(0)
        assertEquals("time", step.getJSONObject("target").getString("type"))
        assertEquals(120, step.getJSONObject("target").getInt("sec"))
        assertTrue(updated.has("updatedAt"))
    }

    @Test
    fun updateStepTargetFindsStepNestedInRepeatBlock() {
        val newTarget = JSONObject().put("type", "distance").put("m", 500)
        val updated = JSONObject(PlanEdit.updateStepTarget(nestedPlan, "w1", newTarget))
        val rep = updated.getJSONArray("steps").getJSONObject(1)
        val inner = rep.getJSONArray("steps").getJSONObject(0)
        assertEquals(500, inner.getJSONObject("target").getInt("m"))
    }

    @Test
    fun updateStepTargetUnknownIdReturnsUnchanged() {
        val newTarget = JSONObject().put("type", "time").put("sec", 10)
        val updated = PlanEdit.updateStepTarget(topLevelPlan, "missing", newTarget)
        assertEquals(topLevelPlan, updated)
    }

    @Test
    fun appendStepAddsRunOneKm() {
        val (newJson, newId) = PlanEdit.appendStep(topLevelPlan)
        val plan = JSONObject(newJson)
        val steps = plan.getJSONArray("steps")
        assertEquals(2, steps.length())
        val added = steps.getJSONObject(1)
        assertEquals(newId, added.getString("id"))
        assertEquals("run", added.getString("kind"))
        assertEquals("distance", added.getJSONObject("target").getString("type"))
        assertEquals(1000, added.getJSONObject("target").getInt("m"))
    }

    @Test
    fun bezelIncrementDistanceThresholds() {
        assertEquals(50, PlanEdit.bezelIncrement(0, 1, "distance"))
        assertEquals(1950, PlanEdit.bezelIncrement(1900, 1, "distance"))
        assertEquals(2100, PlanEdit.bezelIncrement(2000, 1, "distance")) // at boundary: 100m step
        assertEquals(10500, PlanEdit.bezelIncrement(10000, 1, "distance")) // at/above boundary: 500m step
        assertEquals(0, PlanEdit.bezelIncrement(0, -1, "distance")) // clamps at 0
    }

    @Test
    fun bezelIncrementTimeThresholds() {
        assertEquals(15, PlanEdit.bezelIncrement(0, 1, "time"))
        assertEquals(330, PlanEdit.bezelIncrement(300, 1, "time")) // at boundary: 30s step
        assertEquals(1860, PlanEdit.bezelIncrement(1800, 1, "time")) // at/above boundary: 60s step
        assertEquals(0, PlanEdit.bezelIncrement(0, -1, "time")) // clamps at 0
    }
}
