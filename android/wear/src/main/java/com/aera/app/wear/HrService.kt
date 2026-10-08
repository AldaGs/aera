package com.aera.app.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.health.services.client.HealthServices
import android.os.PowerManager
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.BatchingMode
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import android.app.PendingIntent
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground service that streams live HR/cadence to the phone (`/aera/hr`, `/aera/cadence`)
 * during a phone-recorded run. Uses an ExerciseClient session (like Samsung Health), not
 * MeasureClient: MeasureClient is for on-screen spot readings and gets throttled once the
 * app leaves the foreground. HR batching is overridden to 5 s so screen-off updates keep
 * flowing instead of arriving in multi-minute bursts.
 */
class HrService : Service() {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val exerciseClient by lazy { HealthServices.getClient(this).exerciseClient }
    private var wakeLock: PowerManager.WakeLock? = null

    private val callback = object : ExerciseUpdateCallback {
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {
            Log.w("aera-wear", "HR registration failed: ${throwable.message}")
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {
            Log.d("aera-wear", "HR availability: $availability")
        }
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) {
            if (update.exerciseStateInfo.state.isEnded) {
                stopSelf()
                return
            }
            val m = update.latestMetrics
            m.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value?.toInt()?.takeIf { it > 0 }?.let {
                AeraState.hr = it
                sendData("/aera/hr", it)
            }
            m.getData(DataType.STEPS_PER_MINUTE).lastOrNull()?.value?.toInt()?.takeIf { it > 0 }?.let {
                sendData("/aera/cadence", it)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        AeraState.measuring = true
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aera:hr")
            .apply { acquire(6 * 3600_000L) } // ponytail: 6 h cap, safety net if onDestroy never runs
        scope.launch {
            try {
                val all = exerciseClient.getCapabilitiesAsync().get()
                val caps = all.getExerciseTypeCapabilities(ExerciseType.RUNNING)
                val types = setOf(DataType.HEART_RATE_BPM, DataType.STEPS_PER_MINUTE)
                    .filter { it in caps.supportedDataTypes }.toSet()
                val batching = setOf(BatchingMode.HEART_RATE_5_SECONDS)
                    .filter { it in all.supportedBatchingModeOverrides }.toSet()
                val config = ExerciseConfig.builder(ExerciseType.RUNNING)
                    .setDataTypes(types)
                    .setIsGpsEnabled(false)
                    .setIsAutoPauseAndResumeEnabled(false)
                    .setBatchingModeOverrides(batching)
                    .build()
                exerciseClient.setUpdateCallback(mainExecutor, callback)
                exerciseClient.startExerciseAsync(config).get()
            } catch (e: Exception) {
                Log.w("aera-wear", "HR exercise start failed: ${e.message}")
                stopSelf()
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        AeraState.measuring = false
        try {
            exerciseClient.clearUpdateCallbackAsync(callback)
            exerciseClient.endExerciseAsync()
        } catch (_: Exception) {
        }
        wakeLock?.takeIf { it.isHeld }?.release()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun sendData(path: String, value: Int) {
        scope.launch {
            try {
                val nodes = Tasks.await(Wearable.getNodeClient(this@HrService).connectedNodes)
                val mc = Wearable.getMessageClient(this@HrService)
                val payload = value.toString().toByteArray()
                for (n in nodes) mc.sendMessage(n.id, path, payload)
            } catch (e: Exception) {
                Log.w("aera-wear", "sendData failed: ${e.message}")
            }
        }
    }

    private fun startForegroundNotification() {
        val chanId = "aera_hr"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(chanId, "aera HR", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val notif: Notification = Notification.Builder(this, chanId)
            .setContentTitle("aera")
            .setContentText("Tracking workout")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .build()
            
        val ongoingActivityStatus = Status.Builder()
            .addTemplate("Tracking")
            .build()
            
        val intent = Intent(this, RecordActivity::class.java).putExtra(RecordActivity.EXTRA_MIRROR, true)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val ongoingActivity = OngoingActivity.Builder(this, 1, notif.let { androidx.core.app.NotificationCompat.Builder(this, notif) })
            .setAnimatedIcon(android.R.drawable.ic_menu_compass)
            .setStaticIcon(android.R.drawable.ic_menu_compass)
            .setTouchIntent(pendingIntent)
            .setStatus(ongoingActivityStatus)
            .build()
            
        ongoingActivity.apply(this)

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        } else {
            startForeground(1, notif)
        }
    }
}
