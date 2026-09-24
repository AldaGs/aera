package com.aera.app.wear

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Per-sport menu (Samsung Health style step 2): Free / Quick goal / synced plans filtered
 * to this sport. Replaces the old flat PlansActivity list now that sport is picked first.
 */
class SportMenuActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sport = intent.getStringExtra(EXTRA_SPORT) ?: "run"
        setContent {
            AeraTheme {
                SportMenuScreen(
                    sport = sport,
                    onFree = { PlanActions.startFree(this, sport) },
                    onPlan = { plan ->
                        startActivity(Intent(this, PlanDetailActivity::class.java).putExtra(PlanDetailActivity.EXTRA_PLAN_JSON, plan.toString()))
                    },
                    onQuickGoal = {
                        startActivity(Intent(this, QuickGoalActivity::class.java).putExtra(QuickGoalActivity.EXTRA_SPORT, sport))
                    },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Phase 5: retry any standalone recordings the phone hasn't acked yet.
        Thread { WorkoutSync.retryPending(this) }.start()
    }

    companion object {
        const val EXTRA_SPORT = "sport"
    }
}

private fun planLabel(plan: JSONObject): Pair<String, String?> {
    val name = plan.optString("name", "Plan")
    val steps = plan.optJSONArray("steps")
    val n = steps?.length() ?: 0
    return name to (if (n > 0) "synced from phone · $n steps" else "synced from phone")
}

/** Plans with no "sport" field are treated as runs (pre-sport-field plans). */
private fun planSport(plan: JSONObject) = plan.optString("sport").ifEmpty { "run" }

@Composable
private fun SportMenuScreen(sport: String, onFree: () -> Unit, onPlan: (JSONObject) -> Unit, onQuickGoal: () -> Unit) {
    val context = LocalContext.current
    var plans by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(sport) {
        plans = withContext(Dispatchers.IO) { PlanStore.listPlans(context).filter { planSport(it) == sport } }
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
                item {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                        Image(
                            painter = painterResource(sportIcon(sport)),
                            contentDescription = null,
                            colorFilter = ColorFilter.tint(Nocturne.accent300),
                            modifier = Modifier.size(28.dp),
                        )
                        Text(sportLabel(sport), color = Nocturne.text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    }
                }
                item { PlanChip(title = "Free", subtitle = null, onClick = onFree) }
                item { PlanChip(title = "Quick goal", subtitle = null, onClick = onQuickGoal) }
                if (plans.isEmpty()) {
                    item {
                        Text(
                            "Build workouts on your phone",
                            color = Nocturne.neutral500,
                            fontSize = 12.sp,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 10.dp, horizontal = 12.dp),
                        )
                    }
                } else {
                    items(plans) { plan ->
                        val (title, subtitle) = planLabel(plan)
                        PlanChip(title = title, subtitle = subtitle, onClick = { onPlan(plan) })
                    }
                }
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
