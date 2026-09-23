package com.aera.app.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Receives phone → watch messages: `/aera/step` (mirror the current interval step),
 * `/aera/cue` (buzz on a transition), `/aera/stop` (finish → stop HR service),
 * `/aera/startwatch` (standalone start, see [handleStartWatch]), `/aera/ping`
 * (reply with battery so the phone's New run sheet can show it).
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
            "/aera/startwatch" -> handleStartWatch(String(event.data))
            "/aera/ping" -> replyBattery()
        }
    }

    /**
     * Standalone start requested from the phone's "Watch only" card: `{sport, plan?}`.
     *
     * Launching an Activity straight from a WearableListenerService hits the same
     * Android 10+ background-activity-launch restrictions as any other background
     * component — Wear OS does not grant this service an exemption. Starting a
     * *foreground service* does still work here though: message delivery runs this
     * service in a briefly-active state, the same kind of window a BroadcastReceiver
     * gets in onReceive(), which is enough to call startForegroundService(). So when
     * the run/location/sensor permissions are already granted (the common case — the
     * watch was used standalone before), start ExerciseService directly; its own
     * Ongoing Activity notification (contentIntent -> RecordActivity) gives the user
     * a way back into the live screen. When a permission is still missing, only a
     * full-screen high-priority notification can reliably raise an Activity from the
     * background, so fall back to that instead of trying (and likely failing) a
     * blind startActivity().
     */
    private fun handleStartWatch(json: String) {
        val o = try {
            JSONObject(json)
        } catch (e: Exception) {
            Log.w("aera-wear", "bad startwatch payload: ${e.message}")
            return
        }
        val sport = o.optString("sport", "run")
        val planJson = o.optJSONObject("plan")?.toString()

        val granted = RecordActivity.REQUIRED_PERMISSIONS.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
        if (granted) {
            if (!ExerciseService.isRunning()) {
                val intent = Intent(this, ExerciseService::class.java)
                intent.putExtra(ExerciseService.EXTRA_SPORT, sport)
                if (planJson != null) intent.putExtra(ExerciseService.EXTRA_PLAN_JSON, planJson)
                try {
                    ContextCompat.startForegroundService(this, intent)
                } catch (e: Exception) {
                    // Android 12+ may refuse a background FGS start; let the user tap in instead.
                    Log.w("aera-wear", "background FGS start refused: ${e.message}")
                    postStartNotification(this, sport, planJson)
                }
            }
        } else {
            postStartNotification(this, sport, planJson)
        }
    }

    private fun replyBattery() {
        val bm = getSystemService(BATTERY_SERVICE) as? BatteryManager ?: return
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val ctx = applicationContext
        Thread {
            try {
                val nodes = Tasks.await(Wearable.getNodeClient(ctx).connectedNodes)
                val mc = Wearable.getMessageClient(ctx)
                for (n in nodes) Tasks.await(mc.sendMessage(n.id, "/aera/battery", pct.toString().toByteArray()))
            } catch (e: Exception) {
                Log.w("aera-wear", "battery reply failed: ${e.message}")
            }
        }.start()
    }

    // Plans are read straight from the DataClient (PlanStore) where needed (e.g.
    // MainActivity.onResume); this just confirms delivery in logcat for now.
    override fun onDataChanged(dataEvents: DataEventBuffer) {
        val planChanges = dataEvents.count { it.dataItem.uri.path.orEmpty().startsWith("/aera/plan/") }
        if (planChanges > 0) Log.d("aera-wear", "plan DataItems changed: $planChanges")
        dataEvents.release()
    }

    private fun vibrate(kind: String) {
        val v = vibrator() ?: return
        // Patterns roughly match the phone's fireCue: work = strong double, others lighter.
        val pattern = when (kind) {
            "work", "run" -> longArrayOf(0, 220, 120, 220)
            "recovery", "walk" -> longArrayOf(0, 120)
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

    companion object {
        /** "Tap to start your run" full-screen notification → RecordActivity (permission flow). */
        fun postStartNotification(ctx: Context, sport: String, planJson: String?) {
            val recordIntent = Intent(ctx, RecordActivity::class.java)
            recordIntent.putExtra(RecordActivity.EXTRA_SPORT, sport)
            if (planJson != null) recordIntent.putExtra(RecordActivity.EXTRA_PLAN_JSON, planJson)
            recordIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            val pending = PendingIntent.getActivity(
                ctx, 3, recordIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val chanId = "aera_start"
            val nm = ctx.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(chanId, "aera start run", NotificationManager.IMPORTANCE_HIGH),
                )
            }
            val notif = NotificationCompat.Builder(ctx, chanId)
                .setContentTitle("aera")
                .setContentText("Tap to start your run on the watch")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setFullScreenIntent(pending, true)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build()
            nm.notify(3, notif)
        }
    }
}
