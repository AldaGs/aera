package com.aera.app.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import com.aera.app.wear.ui.theme.AeraTheme
import org.json.JSONObject

/**
 * Standalone recording screen: elapsed/distance/HR + current plan step, mirroring
 * ExerciseService (via RecState) the same way MainActivity mirrors HrService/AeraState.
 * Requests the runtime permissions ExerciseService needs, then starts it, then shows
 * live (1h/1i/1j) / paused (1l) / summary (1m) from RecState, polling every 500 ms.
 * Stays open through Summary — that screen calls finish() itself on dismiss.
 */
class RecordActivity : ComponentActivity() {
    private val handler = Handler(Looper.getMainLooper())
    private var refreshTick by mutableStateOf(0)
    // Only leave once a recording has actually run: before the service starts (or
    // while the permission prompt is up) RecState.running is still false.
    private var sawRunning = false

    private val refresh = object : Runnable {
        override fun run() {
            if (RecState.running) sawRunning = true
            if (RecState.mirror && !RecState.paused && RecState.countdown == 0 && RecState.mirrorRxAt > 0) {
                // Extrapolate the phone clock between ~1 Hz messages so seconds flip in step.
                RecState.elapsedSec = ((RecState.mirrorElapsedMs + SystemClock.elapsedRealtime() - RecState.mirrorRxAt) / 1000).toInt()
            }
            if (sawRunning && !RecState.running && !RecState.paused && !RecState.summaryReady) {
                // ExerciseService stopped itself without a summary (e.g. failed to start) — leave.
                finish()
                return
            }
            refreshTick++
            handler.postDelayed(this, if (RecState.mirror) 200 else 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AeraTheme {
                @Suppress("UNUSED_EXPRESSION") refreshTick // read to recompose on tick
                when {
                    RecState.mirror && RecState.countdown > 0 -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("${RecState.countdown}", fontSize = 72.sp, fontWeight = FontWeight.Bold)
                    }
                    RecState.summaryReady -> SummaryScreen(
                        sport = intent.getStringExtra(EXTRA_SPORT) ?: sportOf(intent.getStringExtra(EXTRA_PLAN_JSON)),
                        distanceM = RecState.sumDistanceM,
                        durationSec = RecState.sumDurationSec,
                        avgPaceSecPerKm = RecState.sumAvgPaceSecPerKm,
                        avgHr = RecState.sumAvgHr,
                        zoneSecs = RecState.sumZoneSecs,
                        syncState = RecState.syncState,
                        onDismiss = { finish() },
                    )
                    RecState.paused -> PausedScreen(
                        elapsedSec = RecState.elapsedSec,
                        distanceM = RecState.distanceM,
                        autoPaused = RecState.autoPaused,
                        onLap = { lap() },
                        onResume = { ctl("resume") { ExerciseService.resume() } },
                        onEnd = { ctl("stop") { ExerciseService.stop() } },
                    )
                    else -> LiveScreen(
                        data = LiveData.from(RecState),
                        lastLap = RecState.lastLap,
                        lastLapAtMs = RecState.lastLapAtMs,
                        onPause = { ctl("pause") { ExerciseService.pause() } },
                    )
                }
            }
        }

        if (mirror) return // phone owns the recording; RecState is fed by PhoneListener
        val sport = intent.getStringExtra(EXTRA_SPORT) ?: "run"
        val planJson = intent.getStringExtra(EXTRA_PLAN_JSON)
        ensurePermissionsThenStart(sport, planJson)
    }

    private val mirror get() = intent.getBooleanExtra(EXTRA_MIRROR, false)

    /** Mirror mode forwards controls to the phone; standalone drives ExerciseService. */
    private fun ctl(cmd: String, local: () -> Unit) {
        if (mirror) Thread { WearCmd.send(this, cmd) }.start() else local()
    }

    private fun lap() = ctl("lap") { ExerciseService.lapOrNext() }

    /** Bottom key doubles as manual lap while recording — guarded per-device since not every
     * Wear OS watch exposes a KEYCODE_STEM_* for it; falls back to the on-screen Lap button. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (RecState.running &&
            (keyCode == KeyEvent.KEYCODE_STEM_1 || keyCode == KeyEvent.KEYCODE_STEM_2 || keyCode == KeyEvent.KEYCODE_STEM_3)
        ) {
            lap()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refresh)
    }

    private fun ensurePermissionsThenStart(sport: String, planJson: String?) {
        val needed = REQUIRED_PERMISSIONS.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isEmpty()) {
            startService(sport, planJson)
        } else {
            pendingSport = sport
            pendingPlanJson = planJson
            requestPermissions(needed.toTypedArray(), 1)
        }
    }

    private var pendingSport: String? = null
    private var pendingPlanJson: String? = null

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1) {
            val sport = pendingSport ?: "run"
            startService(sport, pendingPlanJson)
        }
    }

    private fun startService(sport: String, planJson: String?) {
        if (ExerciseService.isRunning()) return
        val intent = Intent(this, ExerciseService::class.java)
        intent.putExtra(ExerciseService.EXTRA_SPORT, sport)
        if (planJson != null) intent.putExtra(ExerciseService.EXTRA_PLAN_JSON, planJson)
        ContextCompat.startForegroundService(this, intent)
    }

    companion object {
        const val EXTRA_SPORT = "sport"
        const val EXTRA_PLAN_JSON = "planJson"
        const val EXTRA_MIRROR = "mirror"

        val REQUIRED_PERMISSIONS: List<String> = buildList {
            add(Manifest.permission.BODY_SENSORS)
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            if (Build.VERSION.SDK_INT >= 29) add(Manifest.permission.ACTIVITY_RECOGNITION)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        }

        /** Reads sport straight off the plan JSON, if present, else defaults to "run". */
        fun sportOf(planJson: String?): String {
            if (planJson == null) return "run"
            return try { JSONObject(planJson).optString("sport", "run") } catch (e: Exception) { "run" }
        }
    }
}
