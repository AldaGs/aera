package com.aera.app.wear

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.material.Text
import com.aera.app.wear.ui.theme.AeraTheme
import com.aera.app.wear.ui.theme.Nocturne
import org.json.JSONObject

/** Run/Walk/Ride, in carousel order. */
internal val SPORTS = listOf("run", "walk", "ride")
internal fun sportLabel(s: String) = s.replaceFirstChar { it.uppercase() }
internal fun sportIcon(s: String) = when (s) {
    "walk" -> R.drawable.ic_sport_walk
    "ride" -> R.drawable.ic_sport_ride
    else -> R.drawable.ic_sport_run
}

private const val PREFS = "aera_wear"
private const val KEY_LAST_SPORT = "last_sport"

private fun lastSportIndex(context: Context): Int {
    val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val idx = SPORTS.indexOf(prefs.getString(KEY_LAST_SPORT, "run"))
    return if (idx >= 0) idx else 0
}

private fun saveLastSport(context: Context, sport: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LAST_SPORT, sport).apply()
}

/**
 * Shared "start a run" behavior (phone hand-off, falling back to a standalone watch
 * recording): originally lived in PlansActivity, now also used from PlanDetailActivity's
 * Start chip (F9 2c) and SportMenuActivity's Free item.
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
                    showPhoneMirror(activity)
                } else {
                    startStandalone(activity, planJson, null)
                }
            }
        }.start()
    }

    /** Phone is recording: show the HR/step mirror as the only screen (back exits). */
    private fun showPhoneMirror(activity: Activity) {
        activity.startActivity(
            Intent(activity, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
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
                    showPhoneMirror(activity)
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
 * Sport picker (Samsung Health style carousel): Run / Walk / Ride as overlapping circles,
 * centered one enlarged. Bezel rotation and horizontal swipe move selection with a haptic
 * tick; tapping the centered circle opens that sport's menu (SportMenuActivity). Remembers
 * the last selected sport across launches.
 */
class PlansActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AeraTheme {
                SportPickerScreen(
                    initialIndex = lastSportIndex(this),
                    onSelect = { sport ->
                        saveLastSport(this, sport)
                        startActivity(Intent(this, SportMenuActivity::class.java).putExtra(SportMenuActivity.EXTRA_SPORT, sport))
                    },
                )
            }
        }
    }
}

@Composable
private fun SportPickerScreen(initialIndex: Int, onSelect: (String) -> Unit) {
    val context = LocalContext.current
    val vibrator = remember { context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }
    var index by remember { mutableIntStateOf(initialIndex) }
    var lastRotaryMs by remember { mutableLongStateOf(0L) }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    fun tick(amount: Int) {
        val next = (index + amount).coerceIn(0, SPORTS.size - 1)
        if (next != index) {
            index = next
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(15, VibrationEffect.DEFAULT_AMPLITUDE))
            } else vibrator.vibrate(15)
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Nocturne.ground)
            .focusRequester(focusRequester)
            .focusable()
            .onRotaryScrollEvent { event ->
                // Galaxy touch bezel: one event per detent, so each click = one step
                // (a pixel threshold made single clicks do nothing, which felt laggy).
                // Short debounce keeps a high-res crown from skipping several items.
                val now = event.uptimeMillis
                if (event.verticalScrollPixels != 0f && now - lastRotaryMs > 70) {
                    lastRotaryMs = now
                    tick(if (event.verticalScrollPixels > 0) 1 else -1)
                }
                true
            }
            .pointerInput(Unit) {
                var dragAccum = 0f
                detectHorizontalDragGestures(
                    onDragStart = { dragAccum = 0f },
                    onHorizontalDrag = { _, amount -> dragAccum += amount },
                    onDragEnd = {
                        if (dragAccum < -40f) tick(1) else if (dragAccum > 40f) tick(-1)
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(sportLabel(SPORTS[index]), color = Nocturne.text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(8.dp))
            // Every circle is placed relative to the selected one, which sits dead
            // center (Samsung-style); neighbors overlap behind it, smaller and faded.
            val pos by animateFloatAsState(index.toFloat(), tween(110), label = "pos")
            Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) {
                SPORTS.withIndex()
                    .sortedByDescending { (i, _) -> kotlin.math.abs(i - index) } // selected drawn last (on top)
                    .forEach { (i, sport) ->
                        val d = i - pos // signed distance from center, animated
                        val dist = kotlin.math.abs(d)
                        val centered = i == index
                        val size = (110f - 30f * dist.coerceAtMost(1f) - 16f * (dist - 1f).coerceIn(0f, 1f)).dp
                        Box(
                            Modifier
                                .offset(x = (d * 68f).dp)
                                .size(size)
                                .alpha(if (dist < 0.5f) 1f else (1f - 0.35f * dist).coerceAtLeast(0.3f))
                                .clip(CircleShape) // round tap ripple, not a square
                                .background(if (centered) Nocturne.accent500 else Nocturne.accent800)
                                .clickable(enabled = centered) { onSelect(sport) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Image(
                                painter = painterResource(sportIcon(sport)),
                                contentDescription = sportLabel(sport),
                                colorFilter = ColorFilter.tint(if (centered) Nocturne.ground else Nocturne.neutral400),
                                modifier = Modifier.size(size * 0.5f),
                            )
                        }
                    }
            }
            Spacer(Modifier.height(10.dp))
            Row {
                SPORTS.forEachIndexed { i, _ ->
                    Box(
                        Modifier
                            .padding(horizontal = 3.dp)
                            .size(if (i == index) 6.dp else 4.dp)
                            .background(if (i == index) Nocturne.accent300 else Nocturne.neutral600, CircleShape),
                    )
                }
            }
        }
    }
}

