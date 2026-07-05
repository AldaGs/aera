package com.aera.app.wear

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * The aera watch screen: a big live HR number, the current interval step +
 * countdown mirrored from the phone, and a Start/Stop toggle for the HR service.
 * Plain Views + a 500 ms poll of [AeraState] — no Compose, no theme constraints.
 */
class MainActivity : Activity() {

    private lateinit var hrText: TextView
    private lateinit var stepText: TextView
    private lateinit var countdownText: TextView
    private lateinit var toggle: Button
    private val handler = Handler(Looper.getMainLooper())

    private val refresh = object : Runnable {
        override fun run() {
            hrText.text = if (AeraState.hr > 0) AeraState.hr.toString() else "--"
            val label = AeraState.stepLabel
            stepText.text = label
            val rem = AeraState.remainingNow()
            countdownText.text = if (label.isNotEmpty() && rem > 0) fmt(rem) else ""
            toggle.text = getString(if (AeraState.measuring) R.string.stop else R.string.start)
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        hrText = findViewById(R.id.hr)
        stepText = findViewById(R.id.step)
        countdownText = findViewById(R.id.countdown)
        toggle = findViewById(R.id.toggle)
        toggle.setOnClickListener { toggleMeasuring() }
        ensurePermissions()
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresh)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refresh)
    }

    private fun toggleMeasuring() {
        val intent = Intent(this, HrService::class.java)
        if (AeraState.measuring) {
            stopService(intent)
        } else if (hasBodySensors()) {
            ContextCompat.startForegroundService(this, intent)
        } else {
            ensurePermissions()
        }
    }

    private fun hasBodySensors() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.BODY_SENSORS) ==
            PackageManager.PERMISSION_GRANTED

    private fun ensurePermissions() {
        val needed = mutableListOf<String>()
        if (!hasBodySensors()) needed.add(Manifest.permission.BODY_SENSORS)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isNotEmpty()) requestPermissions(needed.toTypedArray(), 1)
    }

    private fun fmt(sec: Int): String {
        val m = sec / 60
        val s = sec % 60
        return if (m > 0) "%d:%02d".format(m, s) else "${s}s"
    }
}
