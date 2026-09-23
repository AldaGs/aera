package com.aera.app.wear

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
 * Plan list (1g/2c): Free run, then synced plans, then Quick goal. Tapping a
 * plan/free-run starts it on the phone via WearCmd, falling back to a
 * standalone recording if no phone is connected.
 */
class PlansActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AeraTheme {
                PlansScreen(
                    onFreeRun = { startFreeRun() },
                    onPlan = { startPlan(it) },
                    onQuickGoal = { startActivity(Intent(this, QuickGoalActivity::class.java)) },
                )
            }
        }
    }

    private fun startPlan(plan: JSONObject) {
        Thread {
            val planJson = plan.toString()
            val sent = WearCmd.send(this, "start:$planJson")
            runOnUiThread {
                if (sent) {
                    ContextCompat.startForegroundService(this, Intent(this, HrService::class.java))
                    finish()
                } else {
                    startStandalone(planJson)
                }
            }
        }.start()
    }

    private fun startFreeRun() {
        Thread {
            val sent = WearCmd.send(this, "start")
            runOnUiThread {
                if (sent) {
                    ContextCompat.startForegroundService(this, Intent(this, HrService::class.java))
                    finish()
                } else {
                    startStandalone(null)
                }
            }
        }.start()
    }

    /** No phone connected: record directly on the watch via ExerciseService (Phase 4). */
    private fun startStandalone(planJson: String?) {
        val intent = Intent(this, RecordActivity::class.java)
        intent.putExtra(RecordActivity.EXTRA_SPORT, RecordActivity.sportOf(planJson))
        if (planJson != null) intent.putExtra(RecordActivity.EXTRA_PLAN_JSON, planJson)
        startActivity(intent)
        finish()
    }
}

private fun planLabel(plan: JSONObject): Pair<String, String?> {
    val name = plan.optString("name", "Plan")
    val steps = plan.optJSONArray("steps")
    val n = steps?.length() ?: 0
    return name to (if (n > 0) "synced from phone · $n steps" else "synced from phone")
}

@Composable
private fun PlansScreen(onFreeRun: () -> Unit, onPlan: (JSONObject) -> Unit, onQuickGoal: () -> Unit) {
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
                item { PlanChip(title = "Free run", subtitle = null, onClick = onFreeRun) }
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
