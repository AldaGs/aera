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
import android.os.VibrationEffect
import android.os.Vibrator
import android.content.Context
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable

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
    private var lastVibratedSec = -1
    private val vibrator by lazy { getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }

    private val refresh = object : Runnable {
        override fun run() {
            hrText.text = if (AeraState.hr > 0) AeraState.hr.toString() else "--"
            val label = AeraState.stepLabel
            stepText.text = label
            val rem = AeraState.remainingNow()
            countdownText.text = if (label.isNotEmpty() && rem > 0) fmt(rem) else ""
            toggle.text = getString(if (AeraState.measuring) R.string.stop else R.string.start)
            
            if (rem in 1..5 && rem != lastVibratedSec) {
                lastVibratedSec = rem
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    vibrator.vibrate(100)
                }
            } else if (rem <= 0 || rem > 5) {
                lastVibratedSec = -1
            }
            
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
            sendCmd("stop")
        } else if (hasBodySensors()) {
            ContextCompat.startForegroundService(this, intent)
            sendCmd("start")
        } else {
            ensurePermissions()
        }
    }

    private fun sendCmd(cmd: String) {
        Thread {
            try {
                val nodes = Tasks.await(Wearable.getNodeClient(this).connectedNodes)
                val mc = Wearable.getMessageClient(this)
                val payload = cmd.toByteArray()
                for (n in nodes) mc.sendMessage(n.id, "/aera/cmd", payload)
            } catch (e: Exception) {
                // Ignore
            }
        }.start()
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1 && hasBodySensors()) {
            val intent = Intent(this, HrService::class.java)
            ContextCompat.startForegroundService(this, intent)
            sendCmd("start")
        }
    }

    private fun fmt(sec: Int): String {
        val m = sec / 60
        val s = sec % 60
        return if (m > 0) "%d:%02d".format(m, s) else "${s}s"
    }
}
