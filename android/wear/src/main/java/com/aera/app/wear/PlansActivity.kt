package com.aera.app.wear

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.focusable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Shared "start a run" behavior (phone hand-off, falling back to a standalone watch
 * recording): originally lived in PlansActivity, now also used from PlanDetailActivity's
 * Start chip (F9 2c).
 */
object PlanActions {
    /** Starts a plan: send the plan JSON to the phone, or record standalone if unreachable. */
    fun startPlan(activity: Activity, plan: JSONObject) {
        Thread {
            val planJson = plan.toString()
            val sent = WearCmd.send(activity, "start:$planJson")
            activity.runOnUiThread {
                if (sent) {
                    ContextCompat.startForegroundService(activity, Intent(activity, HrService::class.java))
                    activity.finish()
                } else {
                    startStandalone(activity, planJson, null)
                }
            }
        }.start()
    }

    /** Starts an untimed free recording for [sport] ("run"/"walk"/"ride"). */
    fun startFree(activity: Activity, sport: String) {
        Thread {
            // F10: free runs use the same {"free":true,"sport":...} JSON shape as plans so
            // Record.tsx has one payload shape to parse, instead of a bare "start" special case.
            val json = JSONObject().put("free", true).put("sport", sport).toString()
            val sent = WearCmd.send(activity, "start:$json")
            activity.runOnUiThread {
                if (sent) {
                    ContextCompat.startForegroundService(activity, Intent(activity, HrService::class.java))
                    activity.finish()
                } else {
                    startStandalone(activity, null, sport)
                }
            }
        }.start()
    }

    /** No phone connected: record directly on the watch via ExerciseService (Phase 4). */
    private fun startStandalone(activity: Activity, planJson: String?, sport: String?) {
        val intent = Intent(activity, RecordActivity::class.java)
        intent.putExtra(RecordActivity.EXTRA_SPORT, sport ?: RecordActivity.sportOf(planJson))
        if (planJson != null) intent.putExtra(RecordActivity.EXTRA_PLAN_JSON, planJson)
        activity.startActivity(intent)
        activity.finish()
    }
}

/**
 * Plan list (1g/2c): Free run/walk/ride, then synced plans, then Quick goal. Tapping a
 * plan opens its step-list detail (PlanDetailActivity); tapping a free-run chip starts it
 * on the phone via WearCmd, falling back to a standalone recording if no phone is connected.
 */
class PlansActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AeraTheme {
                PlansScreen(
                    onFree = { sport -> PlanActions.startFree(this, sport) },
                    onPlan = { plan ->
                        startActivity(Intent(this, PlanDetailActivity::class.java).putExtra(PlanDetailActivity.EXTRA_PLAN_JSON, plan.toString()))
                    },
                    onQuickGoal = { startActivity(Intent(this, QuickGoalActivity::class.java)) },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Phase 5: retry any standalone recordings the phone hasn't acked yet.
        Thread { WorkoutSync.retryPending(this) }.start()
    }
}

private fun planLabel(plan: JSONObject): Pair<String, String?> {
    val name = plan.optString("name", "Plan")
    val steps = plan.optJSONArray("steps")
    val n = steps?.length() ?: 0
    return name to (if (n > 0) "synced from phone · $n steps" else "synced from phone")
}

@Composable
private fun PlansScreen(onFree: (String) -> Unit, onPlan: (JSONObject) -> Unit, onQuickGoal: () -> Unit) {
    val context = LocalContext.current
    var plans by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(Unit) {
        plans = withContext(Dispatchers.IO) { PlanStore.listPlans(context) }
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
                autoCentering = androidx.wear.compose.foundation.lazy.AutoCenteringParams(itemIndex = 0),
            ) {
                item { PlanChip(title = "Free run", subtitle = null, onClick = { onFree("run") }) }
                item { PlanChip(title = "Free walk", subtitle = null, onClick = { onFree("walk") }) }
                item { PlanChip(title = "Free ride", subtitle = null, onClick = { onFree("ride") }) }
                items(plans) { plan ->
                    val (title, subtitle) = planLabel(plan)
                    PlanChip(title = title, subtitle = subtitle, onClick = { onPlan(plan) })
                }
                item { PlanChip(title = "Quick goal", subtitle = null, onClick = onQuickGoal) }
            }
        }
    }
}

@Composable
private fun PlanChip(title: String, subtitle: String?, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp),
        colors = ChipDefaults.chipColors(
            backgroundColor = Nocturne.accent900,
            contentColor = Nocturne.text,
        ),
        label = { Text(title, fontWeight = FontWeight.Medium, fontSize = 15.sp) },
        secondaryLabel = subtitle?.let { { Text(it, color = Nocturne.accent300, fontSize = 11.sp) } },
    )
}
