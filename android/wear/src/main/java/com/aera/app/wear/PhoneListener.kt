package com.aera.app.wear

import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Receives phone → watch messages: `/aera/step` (mirror the current interval step),
 * `/aera/cue` (buzz on a transition), `/aera/stop` (finish → stop HR service).
 */
class PhoneListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            "/aera/step" -> {
                val o = JSONObject(String(event.data))
                AeraState.setStep(
                    o.optString("label"),
                    o.optString("kind"),
                    o.optInt("remainingSec", 0),
                )
            }
            "/aera/cue" -> vibrate(String(event.data))
            "/aera/stop" -> {
                AeraState.clearStep()
                stopService(Intent(this, HrService::class.java))
            }
        }
    }

    private fun vibrate(kind: String) {
        val v = vibrator() ?: return
        // Patterns roughly match the phone's fireCue: work = strong double, others lighter.
        val pattern = when (kind) {
            "work" -> longArrayOf(0, 220, 120, 220)
            "recovery" -> longArrayOf(0, 120)
            "done" -> longArrayOf(0, 400)
            else -> longArrayOf(0, 180)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION") v.vibrate(pattern, -1)
        }
    }

    private fun vibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(VIBRATOR_SERVICE) as? Vibrator
        }
}
