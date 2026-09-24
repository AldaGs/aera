package com.aera.app.wear

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Pure JSON edits to a synced IntervalPlan's `steps` array (mirrors
 * src/model/intervalPlan.ts). No Android deps, unit-testable like PlanRunner.
 */
object PlanEdit {

    fun isoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }

    /** Find a PlanStepDef by id anywhere in `steps`, recursing into repeat blocks. */
    private fun findStep(steps: JSONArray, stepId: String): JSONObject? {
        for (i in 0 until steps.length()) {
            val o = steps.getJSONObject(i)
            if (o.has("repeat")) {
                findStep(o.getJSONArray("steps"), stepId)?.let { return it }
            } else if (o.optString("id") == stepId) {
                return o
            }
        }
        return null
    }

    /**
     * Replace the `target` of the step with [stepId] (top-level or nested in a repeat
     * block) and bump the plan's updatedAt. Returns the updated plan JSON, unchanged if
     * the step isn't found.
     */
    fun updateStepTarget(planJson: String, stepId: String, newTarget: JSONObject): String {
        val plan = JSONObject(planJson)
        val steps = plan.optJSONArray("steps") ?: return planJson
        val step = findStep(steps, stepId) ?: return planJson
        step.put("target", newTarget)
        plan.put("updatedAt", isoNow())
        return plan.toString()
    }

    /** Append a default Run / 1.00 km step to the plan's top-level `steps` array. */
    fun appendStep(planJson: String): Pair<String, String> {
        val plan = JSONObject(planJson)
        val steps = plan.optJSONArray("steps") ?: JSONArray().also { plan.put("steps", it) }
        val id = UUID.randomUUID().toString()
        val step = JSONObject()
            .put("id", id)
            .put("kind", "run")
            .put("target", JSONObject().put("type", "distance").put("m", 1000))
        steps.put(step)
        plan.put("updatedAt", isoNow())
        return plan.toString() to id
    }

    /**
     * Bezel detent step for a value, per README 2d thresholds. `type` is "distance"
     * (meters) or "time" (seconds). Distance: 50 m (<2 km) / 100 m (<10 km) / 500 m above.
     * Time: 15 s (<5 min) / 30 s (<30 min, chosen threshold) / 60 s above.
     * ponytail: UI clamps the *arc* at the max (10 km / 60 min) but the value itself keeps
     * incrementing past it per the doc — that clamp lives in StepEditActivity, not here.
     */
    fun bezelIncrement(currentValue: Int, direction: Int, type: String): Int {
        val step = if (type == "distance") {
            when {
                currentValue < 2000 -> 50
                currentValue < 10000 -> 100
                else -> 500
            }
        } else {
            when {
                currentValue < 300 -> 15
                currentValue < 1800 -> 30
                else -> 60
            }
        }
        return (currentValue + direction * step).coerceAtLeast(0)
    }
}
