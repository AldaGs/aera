package com.aera.app.wear

import android.content.Context
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import com.aera.app.wear.ui.theme.AeraTheme
import com.aera.app.wear.ui.theme.Nocturne
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import org.json.JSONArray
import org.json.JSONObject

/**
 * Edit-step screen (2d): tick-track arc, bezel-adjusted value, Time/Dist segment, confirm
 * checkmark saves via PlanEdit + PlanStore and finishes back to PlanDetailActivity (which
 * reloads the plan from PlanStore on resume).
 */
class StepEditActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val planJson = intent.getStringExtra(EXTRA_PLAN_JSON) ?: "{}"
        val stepId = intent.getStringExtra(EXTRA_STEP_ID) ?: ""
        val step = findStepJson(JSONObject(planJson).optJSONArray("steps"), stepId)
        val target = step?.optJSONObject("target") ?: JSONObject().put("type", "distance").put("m", 1000)
        val kind = step?.optString("kind") ?: "run"

        setContent {
            AeraTheme {
                StepEditScreen(
                    kind = kind,
                    initialTarget = target,
                    onConfirm = { newTarget ->
                        val updated = PlanEdit.updateStepTarget(planJson, stepId, newTarget)
                        Thread { PlanStore.putPlan(this, updated) }.start()
                        finish()
                    },
                )
            }
        }
    }

    companion object {
        const val EXTRA_PLAN_JSON = "planJson"
        const val EXTRA_STEP_ID = "stepId"
    }
}

private fun findStepJson(steps: JSONArray?, stepId: String): JSONObject? {
    if (steps == null) return null
    for (i in 0 until steps.length()) {
        val o = steps.getJSONObject(i)
        if (o.has("repeat")) {
            findStepJson(o.optJSONArray("steps"), stepId)?.let { return it }
        } else if (o.optString("id") == stepId) {
            return o
        }
    }
    return null
}

private const val ARC_MAX_DIST_M = 10000
private const val ARC_MAX_TIME_SEC = 3600

@Composable
private fun StepEditScreen(kind: String, initialTarget: JSONObject, onConfirm: (JSONObject) -> Unit) {
    val context = LocalContext.current
    val vibrator = remember { context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }

    // 'either'/'manual' default to a two-seg Time/Dist showing whichever is set (Time if both);
    // switching the seg fully commits to that type, dropping the other value. README 2d only
    // shows a Time/Dist seg (no third Both option), so that's what's built here.
    var isTime by remember { mutableStateOf(initialTarget.optString("type") != "distance") }
    var timeSec by remember { mutableIntStateOf(if (initialTarget.has("sec")) initialTarget.optInt("sec") else 120) }
    var distM by remember { mutableIntStateOf(if (initialTarget.has("m")) initialTarget.optInt("m") else 1000) }

    val focusRequester = remember { FocusRequester() }
    var rotaryAccum by remember { mutableFloatStateOf(0f) }
    val rotaryThreshold = 12f

    fun tick() {
        vibrator.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    fun step(direction: Int) {
        if (isTime) timeSec = PlanEdit.bezelIncrement(timeSec, direction, "time")
        else distM = PlanEdit.bezelIncrement(distM, direction, "distance")
        tick()
    }

    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    val value = if (isTime) timeSec else distM
    val max = if (isTime) ARC_MAX_TIME_SEC else ARC_MAX_DIST_M
    // Arc rendering clamps at the max (visual cap at full sweep); the underlying value keeps
    // incrementing past it if the user keeps turning the bezel (README 2d wording).
    val progress = min(1f, value.toFloat() / max)

    Box(
        Modifier
            .fillMaxSize()
            .background(Nocturne.ground)
            .focusRequester(focusRequester)
            .focusable()
            .onRotaryScrollEvent { event ->
                rotaryAccum += event.verticalScrollPixels
                if (rotaryAccum > rotaryThreshold) {
                    step(1); rotaryAccum = 0f
                } else if (rotaryAccum < -rotaryThreshold) {
                    step(-1); rotaryAccum = 0f
                }
                true
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(280.dp)) {
            val r = size.minDimension / 2f * (126f / 140f)
            val center = Offset(size.width / 2f, size.height / 2f)
            val sweepTotal = 240f
            val start = 150f

            // Tick track: short ticks over the 240° sweep.
            val tickCount = 24
            for (i in 0..tickCount) {
                val ang = start + sweepTotal * (i / tickCount.toFloat())
                val rad = Math.toRadians(ang.toDouble())
                val inner = r - 6.dp.toPx()
                val outer = r + 6.dp.toPx()
                val p1 = Offset(center.x + inner * cos(rad).toFloat(), center.y + inner * sin(rad).toFloat())
                val p2 = Offset(center.x + outer * cos(rad).toFloat(), center.y + outer * sin(rad).toFloat())
                drawLine(Nocturne.neutral800, p1, p2, strokeWidth = 2.dp.toPx())
            }

            // Value arc.
            drawArc(
                color = Nocturne.accent500,
                startAngle = start,
                sweepAngle = sweepTotal * progress,
                useCenter = false,
                topLeft = Offset(center.x - r, center.y - r),
                size = Size(r * 2, r * 2),
                style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round),
            )

            // Knob dot at the arc end.
            val knobAngle = Math.toRadians((start + sweepTotal * progress).toDouble())
            val kx = center.x + r * cos(knobAngle).toFloat()
            val ky = center.y + r * sin(knobAngle).toFloat()
            drawCircle(Nocturne.accent100, radius = 3.5.dp.toPx(), center = Offset(kx, ky))
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Step · ${KIND_LABEL[kind] ?: kind.replaceFirstChar { it.uppercase() }}", color = Nocturne.neutral500, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Row {
                SegItem("Time", selected = isTime, onClick = { isTime = true })
                Spacer(Modifier.width(6.dp))
                SegItem("Dist", selected = !isTime, onClick = { isTime = false })
            }
            Spacer(Modifier.height(6.dp))
            Text(
                if (isTime) fmtTimeSec(timeSec) else "%.2f".format(distM / 1000.0),
                color = Nocturne.text, fontSize = 56.sp, fontWeight = FontWeight.Normal,
            )
            Text(
                if (isTime) hintForTime(timeSec) else hintForDist(distM),
                color = Nocturne.neutral500, fontSize = 13.sp,
            )
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier
                    .size(52.dp)
                    .border(1.5.dp, Nocturne.accent, CircleShape)
                    .clickable {
                        val target = if (isTime) {
                            JSONObject().put("type", "time").put("sec", timeSec)
                        } else {
                            JSONObject().put("type", "distance").put("m", distM)
                        }
                        onConfirm(target)
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text("✓", color = Nocturne.accent300, fontSize = 22.sp)
            }
        }
    }
}

@Composable
private fun SegItem(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .background(if (selected) Nocturne.accent800 else Nocturne.surface, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(label, color = if (selected) Nocturne.accent100 else Nocturne.neutral500, fontSize = 11.sp)
    }
}

private fun hintForDist(m: Int): String = when {
    m < 2000 -> "km · 50 m steps"
    m < 10000 -> "km · 100 m steps"
    else -> "km · 500 m steps"
}

private fun hintForTime(sec: Int): String = when {
    sec < 300 -> "min · 15 s steps"
    sec < 1800 -> "min · 30 s steps"
    else -> "min · 1 min steps"
}
