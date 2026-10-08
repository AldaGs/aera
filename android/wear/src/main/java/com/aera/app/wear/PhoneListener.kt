package com.aera.app.wear

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
import java.io.File

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
                    o.optInt("targetZone", 0),
                    o.optInt("maxHr", 0),
                )
            }
            "/aera/cue" -> vibrate(String(event.data))
            "/aera/live" -> applyLive(String(event.data))
            "/aera/stop" -> {
                AeraState.clearStep()
                if (RecState.mirror) {
                    RecState.running = false
                    RecState.paused = false
                    RecState.mirror = false
                    getSystemService(NotificationManager::class.java).cancel(4)
                }
                stopService(Intent(this, HrService::class.java))
            }
            "/aera/hrstart" -> startHr()
            "/aera/startwatch" -> handleStartWatch(String(event.data))
            "/aera/ping" -> replyBattery()
            "/aera/workoutack" -> handleWorkoutAck(String(event.data))
        }
    }

    /** Phone confirmed it stored a workout (Phase 5): drop our local copy and,
     * if it's the one on screen, flip the summary's sync line to "Synced". */
    private fun handleWorkoutAck(id: String) {
        File(filesDir, "workouts/$id.json").delete()
        if (RecState.sumWorkoutId == id) RecState.syncState = "synced"
        val ctx = applicationContext
        Thread {
            try {
                val uri = Uri.Builder().scheme("wear").path("/aera/workout/$id").build()
                Tasks.await(Wearable.getDataClient(ctx).deleteDataItems(uri))
            } catch (e: Exception) {
                Log.w("aera-wear", "delete workout DataItem failed: ${e.message}")
            }
        }.start()
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

    /** Phone started recording: stream HR without the user opening the watch app.
     * Same background-FGS window as [handleStartWatch]. */
    private fun startHr() {
        if (AeraState.measuring || ExerciseService.isRunning()) return
        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED) {
            Log.w("aera-wear", "hrstart: BODY_SENSORS not granted")
            return
        }
        try {
            ContextCompat.startForegroundService(this, Intent(this, HrService::class.java))
        } catch (e: Exception) {
            Log.w("aera-wear", "hrstart refused: ${e.message}")
        }
    }

    /** Phone recording heartbeat (~1 Hz): mirror it into RecState for RecordActivity. */
    private fun applyLive(json: String) {
        if (ExerciseService.isRunning()) return // a watch recording owns RecState
        val o = try { JSONObject(json) } catch (e: Exception) { return }
        val first = !RecState.mirror
        if (first) RecState.reset()
        RecState.mirror = true
        RecState.running = true
        RecState.countdown = o.optInt("countdown")
        if (RecState.countdown > 0) {
            vibrate("countdown")
            if (first) openMirror()
            return
        }
        RecState.mirrorElapsedMs = o.optLong("elapsedMs", o.optInt("elapsedSec") * 1000L)
        RecState.mirrorRxAt = android.os.SystemClock.elapsedRealtime()
        RecState.paused = o.optBoolean("paused")
        RecState.autoPaused = o.optBoolean("autoPaused")
        RecState.elapsedSec = o.optInt("elapsedSec")
        RecState.distanceM = o.optDouble("distanceM", 0.0)
        RecState.paceSecPerKm = o.optInt("paceSecPerKm")
        RecState.hr = o.optInt("hr")
        RecState.stepLabel = o.optString("stepLabel")
        RecState.stepKind = o.optString("stepKind")
        RecState.stepIndex = o.optInt("stepIndex")
        RecState.stepTotal = o.optInt("stepTotal")
        RecState.stepKindIndex = o.optInt("rep", 1)
        RecState.stepKindTotal = o.optInt("reps", 1)
        RecState.stepFraction = o.optDouble("fraction", 0.0).toFloat()
        RecState.remainingSec = o.optInt("remainingSec")
        RecState.stepRemainingM = o.optInt("remainingM")
        RecState.stepTargetM = o.optInt("targetM")
        RecState.nextStepLabel = o.optString("next")
        RecState.targetZone = o.optInt("targetZone")
        RecState.zoneStatus = o.optString("zoneStatus", "none")
        o.optInt("maxHr").takeIf { it > 0 }?.let { RecState.maxHr = it }
        if (first) openMirror()
    }

    /** Background activity launches are blocked, so raise the mirror screen through a
     * full-screen notification (opens directly when the watch is idle; heads-up otherwise). */
    private fun openMirror() {
        val intent = Intent(this, RecordActivity::class.java)
            .putExtra(RecordActivity.EXTRA_MIRROR, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(this, 4, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val nm = getSystemService(NotificationManager::class.java)
        val chanId = "aera_start"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(chanId, "aera start run", NotificationManager.IMPORTANCE_HIGH))
        }
        nm.notify(
            4,
            NotificationCompat.Builder(this, chanId)
                .setContentTitle("aera")
                .setContentText("Phone run in progress")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setFullScreenIntent(pending, true)
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build(),
        )
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
            "zone-high" -> longArrayOf(0, 150, 120, 150) // slow down: 2 short
            "zone-low" -> longArrayOf(0, 500) // speed up: 1 long
            "zone-back" -> longArrayOf(0, 40) // back in zone: 1 very short tick
            "countdown" -> longArrayOf(0, 60)
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
