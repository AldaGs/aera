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
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType
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
 * Foreground service that reads live HR via Health Services `MeasureClient` and
 * streams each sample to the phone over the Data Layer (`/aera/hr`). Foreground +
 * ongoing notification keeps it sampling with the screen off.
 */
class HrService : Service() {

    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val measureClient by lazy { HealthServices.getClient(this).measureClient }

    private val callback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {
            Log.d("aera-wear", "HR availability: $availability")
        }
        override fun onDataReceived(data: DataPointContainer) {
            val hrPoint = data.getData(DataType.HEART_RATE_BPM).lastOrNull()
            if (hrPoint != null) {
                val rounded = hrPoint.value.toInt()
                if (rounded > 0) {
                    AeraState.hr = rounded
                    sendData("/aera/hr", rounded)
                }
            }

            val cadPoint = data.getData(DataType.STEPS_PER_MINUTE).lastOrNull()
            if (cadPoint != null) {
                val roundedCad = cadPoint.value.toInt()
                if (roundedCad > 0) {
                    sendData("/aera/cadence", roundedCad)
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        AeraState.measuring = true
        measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, callback)
        measureClient.registerMeasureCallback(DataType.STEPS_PER_MINUTE, callback)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        AeraState.measuring = false
        try {
            measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, callback)
            measureClient.unregisterMeasureCallbackAsync(DataType.STEPS_PER_MINUTE, callback)
        } catch (_: Exception) {
        }
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
            
        val intent = Intent(this, MainActivity::class.java)
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
