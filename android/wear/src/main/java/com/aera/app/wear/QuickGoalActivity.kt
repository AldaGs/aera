package com.aera.app.wear

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
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
import androidx.core.content.ContextCompat
import androidx.wear.compose.material.Text
import com.aera.app.wear.ui.theme.AeraTheme
import com.aera.app.wear.ui.theme.Nocturne
import java.util.UUID
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import org.json.JSONObject

/**
 * Watch-side "Quick goal" editor (F10.1, restyled from Views to Compose): Time / Distance /
 * Either, bezel-adjusted with the same tick-per-detent logic as the step editor (2d). Saves a
 * 1-step IntervalPlan via PlanStore (syncs to the phone like any authored plan) and starts it.
 */
class QuickGoalActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val sport = intent.getStringExtra(EXTRA_SPORT) ?: "run"
        setContent {
            AeraTheme {
                QuickGoalScreen(onStart = { type, timeSec, distM -> start(sport, type, timeSec, distM) })
            }
        }
    }

    private fun start(sport: String, type: String, timeSec: Int, distM: Int) {
        val id = UUID.randomUUID().toString()
        val now = PlanEdit.isoNow()
        val work = JSONObject().put("type", type)
        val name = when (type) {
            "time" -> { work.put("sec", timeSec); fmtGoalTime(timeSec) }
            "distance" -> { work.put("m", distM); fmtGoalKm(distM) }
            else -> { work.put("sec", timeSec).put("m", distM); "${fmtGoalKm(distM)} or ${fmtGoalTime(timeSec)}" }
        }
        val plan = JSONObject()
            .put("id", id)
            .put("name", name)
            .put("sport", sport)
            .put("steps", org.json.JSONArray().put(JSONObject().put("id", UUID.randomUUID().toString()).put("kind", stepKind(sport)).put("target", work)))
            .put("autoFinish", true)
            .put("createdAt", now)
            .put("updatedAt", now)

        Thread {
            PlanStore.putPlan(this, plan.toString())
            runOnUiThread { PlanActions.startPlan(this, plan) }
        }.start()
    }

    /** Step kind that labels the goal right on the live screen ("Run", "Walk", or neutral "Work"). */
    private fun stepKind(sport: String) = when (sport) {
        "run" -> "run"
        "walk" -> "walk"
        else -> "work"
    }

    companion object {
        const val EXTRA_SPORT = "sport"
    }
}

private fun fmtGoalTime(sec: Int): String = "${sec / 60} min"
private fun fmtGoalKm(m: Int): String = "%.2f km".format(m / 1000.0)

@Composable
private fun QuickGoalScreen(onStart: (type: String, timeSec: Int, distM: Int) -> Unit) {
    val context = LocalContext.current
    val vibrator = remember { context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }

    var type by remember { mutableStateOf("time") } // time | distance | either
    var timeSec by remember { mutableIntStateOf(30 * 60) }
    var distM by remember { mutableIntStateOf(5000) }

    val focusRequester = remember { FocusRequester() }
    var rotaryAccum by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    // Bezel adjusts time when type=time, distance when type=distance; for 'either' the bezel
    // adjusts whichever field the value text currently shows (time, tap-to-switch not needed
    // since both are visible stacked per README 2b's Either spec) — kept simple: adjusts time.
    fun step(direction: Int) {
        if (type == "distance") distM = PlanEdit.bezelIncrement(distM, direction, "distance")
        else timeSec = PlanEdit.bezelIncrement(timeSec, direction, "time")
        vibrator.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Nocturne.ground)
            .focusRequester(focusRequester)
            .focusable()
            .onRotaryScrollEvent { event ->
                rotaryAccum += event.verticalScrollPixels
                if (rotaryAccum > 12f) { step(1); rotaryAccum = 0f }
                else if (rotaryAccum < -12f) { step(-1); rotaryAccum = 0f }
                true
            },
        contentAlignment = Alignment.Center,
    ) {
        val value = if (type == "distance") distM else timeSec
        val max = if (type == "distance") 10000 else 3600
        val progress = min(1f, value.toFloat() / max)

        Canvas(Modifier.size(280.dp)) {
            val r = size.minDimension / 2f * (126f / 140f)
            val center = Offset(size.width / 2f, size.height / 2f)
            drawArc(
                color = Nocturne.neutral800,
                startAngle = 150f, sweepAngle = 240f, useCenter = false,
                topLeft = Offset(center.x - r, center.y - r), size = Size(r * 2, r * 2),
                style = Stroke(width = 10.dp.toPx(), cap = StrokeCap.Butt),
            )
            drawArc(
                color = Nocturne.accent500,
                startAngle = 150f, sweepAngle = 240f * progress, useCenter = false,
                topLeft = Offset(center.x - r, center.y - r), size = Size(r * 2, r * 2),
                style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round),
            )
            val knobAngle = Math.toRadians((150f + 240f * progress).toDouble())
            drawCircle(
                Nocturne.accent100, radius = 3.5.dp.toPx(),
                center = Offset(center.x + r * cos(knobAngle).toFloat(), center.y + r * sin(knobAngle).toFloat()),
            )
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Quick goal", color = Nocturne.neutral500, fontSize = 13.sp)
            Spacer(Modifier.height(6.dp))
            Row {
                TypeSeg("Time", type == "time") { type = "time" }
                Spacer(Modifier.width(4.dp))
                TypeSeg("Dist", type == "distance") { type = "distance" }
                Spacer(Modifier.width(4.dp))
                TypeSeg("Either", type == "either") { type = "either" }
            }
            Spacer(Modifier.height(6.dp))
            if (type != "distance") Text(fmtTimeSec(timeSec), color = Nocturne.text, fontSize = 44.sp, fontWeight = FontWeight.Normal)
            if (type == "either") Text("or", color = Nocturne.neutral600, fontSize = 12.sp)
            if (type != "time") Text("%.2f km".format(distM / 1000.0), color = Nocturne.text, fontSize = 44.sp, fontWeight = FontWeight.Normal)
            Spacer(Modifier.height(10.dp))
            Box(
                Modifier
                    .size(52.dp)
                    .background(Nocturne.accent500, CircleShape)
                    .clickable { onStart(type, timeSec, distM) },
                contentAlignment = Alignment.Center,
            ) {
                Text("▶", color = Nocturne.ground, fontSize = 20.sp)
            }
        }
    }
}

@Composable
private fun TypeSeg(label: String, selected: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .background(if (selected) Nocturne.accent800 else Nocturne.surface, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Text(label, color = if (selected) Nocturne.accent100 else Nocturne.neutral500, fontSize = 11.sp)
    }
}
