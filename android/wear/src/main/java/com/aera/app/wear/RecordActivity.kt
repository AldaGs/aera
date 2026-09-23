package com.aera.app.wear

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Standalone recording screen: elapsed/distance/HR + current plan step, mirroring
 * ExerciseService (via RecState) the same way MainActivity mirrors HrService/AeraState.
 * Requests the runtime permissions ExerciseService needs, then starts it.
 */
class RecordActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var stepText: TextView
    private lateinit var elapsedText: TextView
    private lateinit var distanceText: TextView
    private lateinit var hrText: TextView
    private lateinit var countdownText: TextView
    private lateinit var autoPausedText: TextView
    private lateinit var pauseResumeBtn: Button

    private val refresh = object : Runnable {
        override fun run() {
            val label = RecState.stepLabel
            stepText.text = if (RecState.stepTotal > 0) "$label (${RecState.stepIndex + 1}/${RecState.stepTotal})" else label
            elapsedText.text = fmtTime(RecState.elapsedSec)
            distanceText.text = "%.2f km".format(RecState.distanceM / 1000.0)
            hrText.text = if (RecState.hr > 0) "${RecState.hr} bpm" else "-- bpm"
            countdownText.text = if (RecState.remainingSec > 0) fmtTime(RecState.remainingSec) else ""
            autoPausedText.visibility = if (RecState.autoPaused) View.VISIBLE else View.GONE
            pauseResumeBtn.text = if (RecState.paused) "Resume" else "Pause"
            if (!RecState.running && !RecState.paused) {
                // ExerciseService stopped itself (ended/failed) — leave the screen.
                finish()
                return
            }
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_record)
        stepText = findViewById(R.id.recStep)
        elapsedText = findViewById(R.id.recElapsed)
        distanceText = findViewById(R.id.recDistance)
        hrText = findViewById(R.id.recHr)
        countdownText = findViewById(R.id.recCountdown)
        autoPausedText = findViewById(R.id.recAutoPaused)
        pauseResumeBtn = findViewById(R.id.recPauseResume)

        pauseResumeBtn.setOnClickListener {
            if (RecState.paused) ExerciseService.resume() else ExerciseService.pause()
        }
        findViewById<Button>(R.id.recLap).setOnClickListener { ExerciseService.lapOrNext() }
        findViewById<Button>(R.id.recStop).setOnClickListener { ExerciseService.stop() }

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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
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

    private fun fmtTime(sec: Int): String {
        val m = sec / 60
        val s = sec % 60
        return "%d:%02d".format(m, s)
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
