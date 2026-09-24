package com.aera.app.wear

/** "2:00" / "45s" — shared by QuickGoalActivity, StepEditActivity and PlanDetailActivity (2b-2d). */
fun fmtTimeSec(sec: Int): String {
    val m = sec / 60
    val s = sec % 60
    return if (m > 0) "%d:%02d".format(m, s) else "${s}s"
}

/** Step kind -> display label, mirroring KIND_LABEL in src/model/intervalPlan.ts. */
val KIND_LABEL = mapOf(
    "warmup" to "Warm-up",
    "walk" to "Walk",
    "run" to "Run",
    "work" to "Work",
    "recovery" to "Recovery",
    "cooldown" to "Cooldown",
)
