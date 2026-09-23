package com.aera.app.wear

import org.json.JSONObject

/** Mirrors `StepTarget` in src/model/intervalPlan.ts. type: time|distance|either|manual. */
data class StepTarget(val type: String, val sec: Int = 0, val m: Int = 0)

/** Mirrors `PlanStep` in src/model/intervalPlan.ts. kind: warmup|work|recovery|cooldown. */
data class PlanStep(val kind: String, val target: StepTarget, val label: String)

/**
 * Steps a flattened plan forward on ExerciseUpdate ticks, mirroring
 * `flattenPlan`/`checkPlanAdvance`/`advanceStep` in src/model/intervalPlan.ts and
 * src/record/engine.ts. Pure Kotlin (no Android/JSON deps) so it's unit-testable;
 * JSON parsing lives in [fromJson] below and isn't itself tested.
 */
class PlanRunner(private val steps: List<PlanStep>, val autoFinish: Boolean) {
    var stepIndex = 0; private set
    var complete = false; private set
    private var stepStartMs = 0L
    private var stepStartDist = 0.0

    val currentStep: PlanStep get() = steps[stepIndex]
    val total: Int get() = steps.size

    /** Call on every ExerciseUpdate with cumulative active-duration ms / distance m.
     * Returns true if the step (or plan completion) changed. */
    fun onUpdate(elapsedMs: Long, distanceM: Double): Boolean {
        if (complete) return false
        val t = currentStep.target
        val met = when (t.type) {
            "time" -> elapsedMs - stepStartMs >= t.sec * 1000L
            "distance" -> distanceM - stepStartDist >= t.m
            "either" -> elapsedMs - stepStartMs >= t.sec * 1000L || distanceM - stepStartDist >= t.m
            else -> false // manual steps only advance via next()
        }
        return if (met) advance(elapsedMs, distanceM) else false
    }

    /** Manual "Lap/Next" tap: always advances regardless of target type. */
    fun next(elapsedMs: Long, distanceM: Double): Boolean = advance(elapsedMs, distanceM)

    private fun advance(elapsedMs: Long, distanceM: Double): Boolean {
        val nextIdx = stepIndex + 1
        if (nextIdx >= steps.size) {
            complete = true
            return true
        }
        stepIndex = nextIdx
        stepStartMs = elapsedMs
        stepStartDist = distanceM
        return true
    }

    /** Seconds left in the current step, for time/either targets; 0 otherwise. */
    fun remainingSec(elapsedMs: Long): Int {
        val t = currentStep.target
        if (t.type != "time" && t.type != "either") return 0
        return ((t.sec * 1000L - (elapsedMs - stepStartMs)) / 1000).coerceAtLeast(0).toInt()
    }

    companion object {
        private val KIND_LABEL = mapOf(
            "warmup" to "Warm-up",
            "work" to "Work",
            "recovery" to "Recovery",
            "cooldown" to "Cooldown",
        )

        /** Expand an authored plan into the flat step list the runner walks. Mirrors flattenPlan(). */
        fun flatten(
            warmup: StepTarget?,
            work: StepTarget,
            recovery: StepTarget?,
            repeats: Int,
            cooldown: StepTarget?,
        ): List<PlanStep> {
            val out = mutableListOf<PlanStep>()
            if (warmup != null) out.add(PlanStep("warmup", warmup, KIND_LABEL.getValue("warmup")))
            val n = maxOf(1, repeats)
            for (i in 1..n) {
                out.add(PlanStep("work", work, "Work $i/$n"))
                if (recovery != null) out.add(PlanStep("recovery", recovery, "Recovery $i/$n"))
            }
            if (cooldown != null) out.add(PlanStep("cooldown", cooldown, KIND_LABEL.getValue("cooldown")))
            return out
        }

        /** Parse a synced IntervalPlan JSON (see PlanStore) into steps + autoFinish. */
        fun fromJson(json: JSONObject): Pair<List<PlanStep>, Boolean> {
            fun target(key: String): StepTarget? {
                val o = json.opt(key) as? JSONObject ?: return null
                return StepTarget(o.optString("type"), o.optInt("sec", 0), o.optInt("m", 0))
            }
            val work = target("work") ?: StepTarget("manual")
            val steps = flatten(target("warmup"), work, target("recovery"), json.optInt("repeats", 1), target("cooldown"))
            return steps to json.optBoolean("autoFinish", true)
        }
    }
}
