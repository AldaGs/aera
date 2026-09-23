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
            "walk" to "Walk",
            "run" to "Run",
            "work" to "Work",
            "recovery" to "Recovery",
            "cooldown" to "Cooldown",
        )

        /** One authored step (or repeat block) before flattening/labeling. Mirrors PlanStepDef/RepeatBlock. */
        private data class RawStep(val kind: String, val target: StepTarget)

        /** Expand an authored plan into the flat step list the runner walks. Mirrors flattenPlan(). */
        fun flatten(
            warmup: StepTarget?,
            work: StepTarget,
            recovery: StepTarget?,
            repeats: Int,
            cooldown: StepTarget?,
        ): List<PlanStep> {
            val raw = mutableListOf<RawStep>()
            if (warmup != null) raw.add(RawStep("warmup", warmup))
            val n = maxOf(1, repeats)
            repeat(n) {
                raw.add(RawStep("work", work))
                if (recovery != null) raw.add(RawStep("recovery", recovery))
            }
            if (cooldown != null) raw.add(RawStep("cooldown", cooldown))
            return label(raw)
        }

        /**
         * Label a flat step list exactly like TS flattenPlan: 'work' always
         * "Work i/n"; every other kind is suffixed " i/n" only when that
         * kind's count > 1; otherwise just KIND_LABEL.
         */
        private fun label(raw: List<RawStep>): List<PlanStep> {
            val totals = raw.groupingBy { it.kind }.eachCount()
            val counters = mutableMapOf<String, Int>()
            return raw.map { s ->
                val n = totals.getValue(s.kind)
                val i = (counters[s.kind] ?: 0) + 1
                counters[s.kind] = i
                val name = KIND_LABEL[s.kind] ?: s.kind
                val lbl = if (s.kind == "work") "Work $i/$n" else if (n > 1) "$name $i/$n" else name
                PlanStep(s.kind, s.target, lbl)
            }
        }

        private fun target(json: JSONObject): StepTarget =
            StepTarget(json.optString("type"), json.optInt("sec", 0), json.optInt("m", 0))

        /** Expand `steps` (new shape: PlanStepDef | RepeatBlock, objects with "repeat"+"steps"). */
        private fun expandSteps(arr: org.json.JSONArray): List<RawStep> {
            val out = mutableListOf<RawStep>()
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                if (o.has("repeat")) {
                    val n = maxOf(1, o.optInt("repeat", 1))
                    val inner = o.optJSONArray("steps") ?: org.json.JSONArray()
                    repeat(n) { out.addAll(expandSteps(inner)) }
                } else {
                    out.add(RawStep(o.optString("kind"), target(o.getJSONObject("target"))))
                }
            }
            return out
        }

        /** Parse a synced IntervalPlan JSON (see PlanStore) into steps + autoFinish.
         * New shape (`steps` array) is read directly; legacy shape (warmup/work/
         * recovery/repeats/cooldown) is mapped the same way TS migratePlan does. */
        fun fromJson(json: JSONObject): Pair<List<PlanStep>, Boolean> {
            val stepsArr = json.optJSONArray("steps")
            val steps = if (stepsArr != null && stepsArr.length() > 0) {
                label(expandSteps(stepsArr))
            } else {
                fun legacyTarget(key: String): StepTarget? {
                    val o = json.opt(key) as? JSONObject ?: return null
                    return target(o)
                }
                val work = legacyTarget("work") ?: StepTarget("manual")
                flatten(legacyTarget("warmup"), work, legacyTarget("recovery"), json.optInt("repeats", 1), legacyTarget("cooldown"))
            }
            return steps to json.optBoolean("autoFinish", true)
        }
    }
}
