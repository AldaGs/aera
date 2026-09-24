package com.aera.app.wear

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.foundation.rotary.RotaryScrollableDefaults
import androidx.wear.compose.foundation.rotary.rotaryScrollable
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.aera.app.wear.ui.theme.AeraTheme
import com.aera.app.wear.ui.theme.Nocturne
import org.json.JSONArray
import org.json.JSONObject

/**
 * Plan detail (2c): header + Start chip + step pills (repeat blocks shown as an
 * "N×" header followed by their inner steps) + "+ Add step". Tapping a step (or
 * "+ Add step") opens StepEditActivity (2d); Start reuses PlanActions (shared
 * with PlansActivity's free-run chips).
 */
class PlanDetailActivity : ComponentActivity() {
    private var planId: String = ""
    private val planJsonState = mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val initialJson = intent.getStringExtra(EXTRA_PLAN_JSON) ?: run { finish(); return }
        planJsonState.value = initialJson
        planId = JSONObject(initialJson).optString("id")

        setContent {
            AeraTheme {
                val planJson by planJsonState
                StepListScreen(
                    plan = JSONObject(planJson),
                    onStart = { PlanActions.startPlan(this@PlanDetailActivity, JSONObject(planJson)) },
                    onStepTap = { stepId -> openEditor(planJson, stepId) },
                    onAddStep = {
                        val (updated, newId) = PlanEdit.appendStep(planJson)
                        planJsonState.value = updated
                        Thread { PlanStore.putPlan(this@PlanDetailActivity, updated) }.start()
                        openEditor(updated, newId)
                    },
                )
            }
        }
    }

    private fun openEditor(planJson: String, stepId: String) {
        val intent = Intent(this, StepEditActivity::class.java)
        intent.putExtra(StepEditActivity.EXTRA_PLAN_JSON, planJson)
        intent.putExtra(StepEditActivity.EXTRA_STEP_ID, stepId)
        startActivity(intent)
    }

    /** StepEditActivity edits and persists independently; re-pull our copy on return
     * so the list reflects the new target without a second round-trip through Intent extras. */
    override fun onResume() {
        super.onResume()
        if (planId.isEmpty()) return
        Thread {
            val fresh = PlanStore.listPlans(this).find { it.optString("id") == planId }
            if (fresh != null) runOnUiThread { planJsonState.value = fresh.toString() }
        }.start()
    }

    companion object {
        const val EXTRA_PLAN_JSON = "planJson"
    }
}

private data class FlatStep(val id: String, val kind: String, val target: JSONObject, val position: Int)

/** Walks `steps`, numbering leaf entries in document order (a repeat block's inner
 * steps are numbered within the block, not multiplied by its repeat count — the
 * header pill carries the "N×" instead). */
private fun numberSteps(steps: JSONArray): List<FlatStep> {
    val out = mutableListOf<FlatStep>()
    var n = 0
    for (i in 0 until steps.length()) {
        val o = steps.getJSONObject(i)
        if (!o.has("repeat")) {
            n++
            out.add(FlatStep(o.optString("id"), o.optString("kind"), o.getJSONObject("target"), n))
        }
    }
    return out
}

private fun formatTarget(t: JSONObject): String = when (t.optString("type")) {
    "time" -> fmtTimeSec(t.optInt("sec"))
    "distance" -> fmtDistM(t.optInt("m"))
    "either" -> "${fmtTimeSec(t.optInt("sec"))} or ${fmtDistM(t.optInt("m"))}"
    else -> "manual"
}

private fun fmtDistM(m: Int): String = if (m >= 1000) "%.2f km".format(m / 1000.0) else "$m m"

@Composable
private fun StepListScreen(plan: JSONObject, onStart: () -> Unit, onStepTap: (String) -> Unit, onAddStep: () -> Unit) {
    val steps = plan.optJSONArray("steps") ?: JSONArray()
    val totalSteps = (0 until steps.length()).sumOf { i ->
        val o = steps.getJSONObject(i)
        if (o.has("repeat")) o.getJSONArray("steps").length() else 1
    }
    val listState = rememberScalingLazyListState()
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Scaffold(
        timeText = { TimeText() },
        positionIndicator = { PositionIndicator(scalingLazyListState = listState) },
    ) {
        Box(Modifier.fillMaxSize().background(Nocturne.ground)) {
            ScalingLazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .rotaryScrollable(
                        RotaryScrollableDefaults.behavior(scrollableState = listState),
                        focusRequester = focusRequester,
                    )
                    .focusRequester(focusRequester)
                    .focusable(),
                state = listState,
            ) {
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                        Text("${plan.optString("name", "Plan")} · $totalSteps steps", color = Nocturne.neutral500, fontSize = 11.sp)
                        Spacer(Modifier.height(6.dp))
                        Chip(
                            onClick = onStart,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
                            colors = ChipDefaults.chipColors(backgroundColor = Nocturne.accent500, contentColor = Nocturne.ground),
                            label = { Text("Start", fontWeight = FontWeight.Medium) },
                        )
                    }
                }
                for (i in 0 until steps.length()) {
                    val o = steps.getJSONObject(i)
                    if (o.has("repeat")) {
                        item {
                            Text(
                                "${o.optInt("repeat", 1)}×",
                                color = Nocturne.accent300,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            )
                        }
                        items(numberSteps(o.getJSONArray("steps"))) { s -> StepPill(s, onStepTap) }
                    } else {
                        val s = FlatStep(o.optString("id"), o.optString("kind"), o.getJSONObject("target"), i + 1)
                        item { StepPill(s, onStepTap) }
                    }
                }
                item {
                    Text(
                        "+ Add step",
                        color = Nocturne.accent300,
                        fontSize = 12.sp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 10.dp)
                            .pointerInput(Unit) { detectTapGestures(onTap = { onAddStep() }) },
                    )
                }
            }
        }
    }
}

@Composable
private fun StepPill(s: FlatStep, onTap: (String) -> Unit) {
    Chip(
        onClick = { onTap(s.id) },
        modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 2.dp),
        colors = ChipDefaults.chipColors(backgroundColor = Nocturne.accent900, contentColor = Nocturne.text),
        label = { Text("${s.position} ${s.kind.replaceFirstChar { it.uppercase() }}", fontWeight = FontWeight.Medium, fontSize = 15.sp) },
        secondaryLabel = { Text(formatTarget(s.target), color = Nocturne.accent300, fontSize = 12.sp) },
    )
}
