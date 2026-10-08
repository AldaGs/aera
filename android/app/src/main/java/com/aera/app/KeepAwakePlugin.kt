package com.aera.app

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Keeps the CPU awake while recording. The geolocation foreground service keeps the
 * GPS on, but with the screen off Doze / Samsung battery optimization still parks the
 * CPU, so fixes stall or arrive in late bursts. A partial wake lock + battery
 * optimization exemption keeps fixes flowing to the WebView at 1 Hz.
 */
@CapacitorPlugin(name = "KeepAwake")
class KeepAwakePlugin : Plugin() {
    private var lock: PowerManager.WakeLock? = null

    @SuppressLint("BatteryLife")
    @PluginMethod
    fun start(call: PluginCall) {
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (lock?.isHeld != true) {
            // ponytail: 6 h cap so a crashed JS side can't hold it forever.
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "aera:recording").apply { acquire(6 * 3600_000L) }
        }
        if (!pm.isIgnoringBatteryOptimizations(context.packageName)) {
            try {
                activity.startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")),
                )
            } catch (_: Exception) {
            }
        }
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        lock?.takeIf { it.isHeld }?.release()
        lock = null
        call.resolve()
    }
}
