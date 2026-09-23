package com.aera.app.wear

import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import com.aera.app.wear.ui.theme.Nocturne
import kotlin.math.cos
import kotlin.math.sin

/**
 * Live-recording readout, polled from [RecState] by the caller (500 ms loop —
 * matches every other screen in this module, no StateFlow plumbing needed for one field set).
 */
data class LiveData(
    val elapsedSec: Int,
    val distanceM: Double,
    val hr: Int,
    val paceSecPerKm: Int,
    val stepLabel: String,
    val stepKind: String,
    val stepIndex: Int,
    val stepTotal: Int,
    val stepKindIndex: Int,
    val stepKindTotal: Int,
    val stepFraction: Float,
    val remainingSec: Int,
    val stepRemainingM: Int,
    val stepTargetM: Int,
    val nextStepLabel: String,
    val gpsSource: String = "watch",
) {
    val hasStep: Boolean get() = stepTotal > 0

    companion object {
        fun from(s: RecState) = LiveData(
            elapsedSec = s.elapsedSec,
            distanceM = s.distanceM,
            hr = s.hr,
            paceSecPerKm = s.paceSecPerKm,
            stepLabel = s.stepLabel,
            stepKind = s.stepKind,
            stepIndex = s.stepIndex,
            stepTotal = s.stepTotal,
            stepKindIndex = s.stepKindIndex,
            stepKindTotal = s.stepKindTotal,
            stepFraction = s.stepFraction,
            remainingSec = s.remainingSec,
            stepRemainingM = s.stepRemainingM,
            stepTargetM = s.stepTargetM,
            nextStepLabel = s.nextStepLabel,
        )
    }
}

/** Persists the bezel-selected layout (0=1h zone arc, 1=1i metric stack, 2=1j interval). */
object LivePrefs {
    private const val PREFS = "aera_wear"
    private const val KEY = "liveLayout"

    fun get(context: Context): Int? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return if (p.contains(KEY)) p.getInt(KEY, 1) else null
    }

    fun set(context: Context, layout: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY, layout).apply()
    }
}

private fun fmtTime(sec: Int): String {
    val s = sec.coerceAtLeast(0)
    val m = s / 60
    val r = s % 60
    return "%d:%02d".format(m, r)
}

private fun fmtPace(secPerKm: Int): String = if (secPerKm > 0) "${fmtTime(secPerKm)} /km" else "-- /km"

private fun fmtKm(m: Double): String = "%.2f".format(m / 1000.0)

/**
 * Full screen: swipe left/right or rotate the bezel to switch 1h/1i/1j; tap toggles the
 * pause/lap/stop overlay (the dedicated Paused screen is a later step — kept minimal here).
 */
@Composable
fun LiveScreen(data: LiveData, onPause: () -> Unit, onResume: () -> Unit, onLap: () -> Unit, onStop: () -> Unit, paused: Boolean) {
    val context = LocalContext.current
    var layout by remember {
        mutableStateOf(LivePrefs.get(context) ?: if (data.hasStep) 2 else 1)
    }
    var showOverlay by remember { mutableStateOf(false) }
    fun setLayout(l: Int) {
        layout = l.coerceIn(0, 2)
        LivePrefs.set(context, layout)
    }

    val focusRequester = remember { FocusRequester() }
    var rotaryAccum by remember { mutableFloatStateOf(0f) }
    val rotaryThreshold = 40f

    Box(
        Modifier
            .fillMaxSize()
            .background(Nocturne.ground)
            .focusRequester(focusRequester)
            .focusable()
            .onRotaryScrollEvent { event ->
                rotaryAccum += event.verticalScrollPixels
                if (rotaryAccum > rotaryThreshold) {
                    setLayout(layout + 1); rotaryAccum = 0f
                } else if (rotaryAccum < -rotaryThreshold) {
                    setLayout(layout - 1); rotaryAccum = 0f
                }
                true
            }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onHorizontalDrag = { _, dragAmount ->
                        if (dragAmount > 25f) setLayout(layout - 1)
                        else if (dragAmount < -25f) setLayout(layout + 1)
                    },
                    onDragEnd = { showOverlay = false },
                )
            },
    ) {
        Box(Modifier.fillMaxSize().pointerInput(Unit) {
            detectTapGestures(onTap = { showOverlay = !showOverlay })
        }) {
            when (layout) {
                0 -> ZoneArcLayout(data)
                2 -> IntervalLayout(data)
                else -> MetricStackLayout(data)
            }
        }
        if (showOverlay) {
            ControlOverlay(
                paused = paused,
                onPause = onPause,
                onResume = onResume,
                onLap = onLap,
                onStop = { showOverlay = false; onStop() },
                onDismiss = { showOverlay = false },
            )
        }
    }

    androidx.compose.runtime.LaunchedEffect(Unit) { focusRequester.requestFocus() }
}

// --- 1h · Live A — HR zone arc ---

@Composable
private fun ZoneArcLayout(data: LiveData) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(280.dp)) {
            val r = size.minDimension / 2f * (128f / 140f)
            val center = Offset(size.width / 2f, size.height / 2f)
            val zoneIdx = Zones.index(data.hr)
            val segSweep = 44f
            val gap = 5f
            for (i in 0 until 5) {
                val start = 150f + i * (segSweep + gap)
                val active = i == zoneIdx
                drawArc(
                    color = Nocturne.zoneColors[i].copy(alpha = if (active) 1f else 0.45f),
                    startAngle = start,
                    sweepAngle = segSweep,
                    useCenter = false,
                    topLeft = Offset(center.x - r, center.y - r),
                    size = Size(r * 2, r * 2),
                    style = Stroke(width = if (active) 9.dp.toPx() else 7.dp.toPx(), cap = StrokeCap.Butt),
                )
            }
            // Marker dot at current HR position.
            val angleDeg = Zones.markerAngleDeg(data.hr)
            val angleRad = Math.toRadians(angleDeg.toDouble())
            val mx = center.x + r * cos(angleRad).toFloat()
            val my = center.y + r * sin(angleRad).toFloat()
            drawCircle(Nocturne.ground, radius = 5.dp.toPx(), center = Offset(mx, my))
            drawCircle(Nocturne.accent100, radius = 3.5.dp.toPx(), center = Offset(mx, my))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(fmtTime(data.elapsedSec), color = Nocturne.neutral500, fontSize = 13.sp)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                HeartIcon(Nocturne.accent400, 16.dp)
                Spacer(Modifier.width(4.dp))
                Text(if (data.hr > 0) "${data.hr}" else "--", color = Nocturne.text, fontSize = 68.sp, fontWeight = FontWeight.Normal)
            }
            Spacer(Modifier.height(2.dp))
            val zoneIdx = Zones.index(data.hr)
            Text("Z${zoneIdx + 1} · ${Zones.names[zoneIdx]}", color = Nocturne.accent300, fontSize = 13.sp)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                MiniMetric(fmtPace(data.paceSecPerKm), "")
                MiniMetric("${fmtKm(data.distanceM)}", "km")
            }
        }
    }
}

@Composable
private fun MiniMetric(value: String, unit: String) {
    Row(verticalAlignment = Alignment.Bottom) {
        Text(value, color = Nocturne.text, fontSize = 20.sp)
        if (unit.isNotEmpty()) {
            Spacer(Modifier.width(2.dp))
            Text(unit, color = Nocturne.neutral500, fontSize = 10.sp)
        }
    }
}

// --- 1i · Live B — four-metric stack ---

@Composable
private fun MetricStackLayout(data: LiveData) {
    Column(
        Modifier.fillMaxSize().padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(fmtTime(data.elapsedSec), color = Nocturne.text, fontSize = 34.sp)
        Spacer(Modifier.height(10.dp))
        FadedDivider(190.dp)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(28.dp), verticalAlignment = Alignment.Bottom) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${fmtKm(data.distanceM)} km", color = Nocturne.text, fontSize = 30.sp)
                Text("distance", color = Nocturne.neutral500, fontSize = 10.sp)
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(fmtPace(data.paceSecPerKm), color = Nocturne.text, fontSize = 30.sp)
                Text("pace", color = Nocturne.neutral500, fontSize = 10.sp)
            }
        }
        Spacer(Modifier.height(10.dp))
        FadedDivider(190.dp)
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HeartIcon(Nocturne.accent400, 18.dp)
            Text(if (data.hr > 0) "${data.hr}" else "--", color = Nocturne.text, fontSize = 30.sp)
            ZoneMeter(Zones.index(data.hr))
        }
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            Box(Modifier.size(5.dp).clip(androidx.compose.foundation.shape.CircleShape).background(Nocturne.neutral500))
            Text("GPS · ${data.gpsSource}", color = Nocturne.neutral500, fontSize = 10.sp)
        }
    }
}

@Composable
private fun ZoneMeter(activeIdx: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        for (i in 0 until 5) {
            val h = (6 + i * 2.5).dp
            val color = when {
                i == activeIdx -> Nocturne.accent500
                i < activeIdx -> Nocturne.accent800
                else -> Nocturne.neutral800
            }
            Box(Modifier.width(4.dp).height(h).background(color))
        }
    }
}

@Composable
private fun FadedDivider(width: androidx.compose.ui.unit.Dp) {
    Box(
        Modifier
            .width(width)
            .height(1.dp)
            .background(
                Brush.horizontalGradient(
                    listOf(Color.Transparent, Nocturne.neutral700, Nocturne.neutral700, Color.Transparent),
                ),
            ),
    )
}

// --- 1j · Live C — interval step ---

@Composable
private fun IntervalLayout(data: LiveData) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(280.dp)) {
            val r = size.minDimension / 2f * (128f / 140f)
            val center = Offset(size.width / 2f, size.height / 2f)
            drawCircle(Nocturne.neutral800, radius = r, center = center, style = Stroke(width = 8.dp.toPx()))
            val sweep = 360f * data.stepFraction.coerceIn(0f, 1f)
            drawArc(
                color = Nocturne.accent500,
                startAngle = -90f,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = Offset(center.x - r, center.y - r),
                size = Size(r * 2, r * 2),
                style = Stroke(width = 8.dp.toPx(), cap = StrokeCap.Round),
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "${data.stepKind.uppercase()} ${data.stepKindIndex} / ${data.stepKindTotal}",
                color = Nocturne.accent300,
                fontSize = 13.sp,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(6.dp))
            if (data.stepTargetM > 0) {
                Row(verticalAlignment = Alignment.Bottom) {
                    Text("${data.stepRemainingM}", color = Nocturne.text, fontSize = 60.sp)
                    Spacer(Modifier.width(4.dp))
                    Text("m", color = Nocturne.neutral500, fontSize = 22.sp)
                }
                Text("left of ${data.stepTargetM} m", color = Nocturne.neutral500, fontSize = 12.sp)
            } else {
                Text(fmtTime(data.remainingSec), color = Nocturne.text, fontSize = 60.sp)
            }
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(fmtPace(data.paceSecPerKm), color = Nocturne.text, fontSize = 15.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    HeartIcon(Nocturne.accent400, 13.dp)
                    Spacer(Modifier.width(3.dp))
                    Text(if (data.hr > 0) "${data.hr}" else "--", color = Nocturne.text, fontSize = 15.sp)
                }
            }
            Spacer(Modifier.height(10.dp))
            if (data.nextStepLabel.isNotEmpty()) {
                Text("Next · ${data.nextStepLabel}", color = Nocturne.neutral500, fontSize = 11.sp)
            }
        }
    }
}

// --- shared bits ---

/** Simple filled heart via two circles + a triangle — skips adding a Phosphor vector
 * drawable asset for a single glyph used at three sizes. */
@Composable
private fun HeartIcon(color: Color, size: androidx.compose.ui.unit.Dp) {
    Canvas(Modifier.size(size)) {
        val w = size.toPx()
        val path = Path().apply {
            moveTo(w / 2f, w * 0.9f)
            cubicTo(-w * 0.1f, w * 0.45f, w * 0.15f, -w * 0.05f, w / 2f, w * 0.3f)
            cubicTo(w * 0.85f, -w * 0.05f, w * 1.1f, w * 0.45f, w / 2f, w * 0.9f)
            close()
        }
        drawPath(path, color)
    }
}

@Composable
private fun ControlOverlay(paused: Boolean, onPause: () -> Unit, onResume: () -> Unit, onLap: () -> Unit, onStop: () -> Unit, onDismiss: () -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Nocturne.ground.copy(alpha = 0.82f))
            .pointerInput(Unit) { detectTapGestures(onTap = { onDismiss() }) },
        contentAlignment = Alignment.Center,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            OverlayButton("Lap", 48.dp) { onLap() }
            OverlayButton(if (paused) "Resume" else "Pause", 64.dp, accent = true) { if (paused) onResume() else onPause() }
            OverlayButton("End", 48.dp) { onStop() }
        }
    }
}

@Composable
private fun OverlayButton(label: String, diameter: androidx.compose.ui.unit.Dp, accent: Boolean = false, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(diameter)
                .clip(androidx.compose.foundation.shape.CircleShape)
                .background(if (accent) Nocturne.accent900 else Nocturne.surface)
                .pointerInput(Unit) { detectTapGestures(onTap = { onClick() }) },
            contentAlignment = Alignment.Center,
        ) {
            Text(label.take(1), color = if (accent) Nocturne.accent300 else Nocturne.text, fontSize = 18.sp)
        }
        Spacer(Modifier.height(4.dp))
        Text(label, color = Nocturne.neutral500, fontSize = 10.sp)
    }
}
