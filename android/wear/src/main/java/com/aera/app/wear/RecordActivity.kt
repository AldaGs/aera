package com.aera.app.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
 * the live layouts (1h/1i/1j) from LiveScreen, polling RecState every 500 ms.
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
            if (sawRunning && !RecState.running && !RecState.paused) {
                // ExerciseService stopped itself (ended/failed) — leave the screen.
                finish()
                return
            }
            refreshTick++
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AeraTheme {
                @Suppress("UNUSED_EXPRESSION") refreshTick // read to recompose on tick
                LiveScreen(
                    data = LiveData.from(RecState),
                    paused = RecState.paused,
                    onPause = { ExerciseService.pause() },
                    onResume = { ExerciseService.resume() },
                    onLap = { ExerciseService.lapOrNext() },
                    onStop = { ExerciseService.stop() },
                )
            }
        }

        val sport = intent.getStringExtra(EXTRA_SPORT) ?: "run"
        val planJson = intent.getStringExtra(EXTRA_PLAN_JSON)
        ensurePermissionsThenStart(sport, planJson)
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
