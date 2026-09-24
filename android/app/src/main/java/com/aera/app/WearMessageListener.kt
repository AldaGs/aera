package com.aera.app

import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import java.io.File

private const val PLAN_JSON_KEY = "json"
private const val WORKOUT_ASSET_KEY = "json"

/**
 * Receives Data-Layer messages from the watch. `/aera/hr` etc. are messages,
 * forwarded to the Capacitor layer via [WearBridgePlugin]. `/aera/plan/{id}` items are
 * DataItems (edited on the watch, or arriving on reconnect) — each change is
 * forwarded as a `planChanged` event so JS can merge it in. `/aera/workout/{id}`
 * items (Phase 5) carry a finished standalone watch recording as an Asset —
 * always persisted to disk, and also forwarded live if the bridge is up.
 */
class WearMessageListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        when (event.path) {
            "/aera/hr" -> {
                val bpm = String(event.data).trim().toDoubleOrNull()?.toInt() ?: return
                WearBridgePlugin.emitHr(bpm)
            }
            "/aera/cadence" -> {
                val cad = String(event.data).trim().toDoubleOrNull()?.toInt() ?: return
                WearBridgePlugin.emitCadence(cad)
            }
            "/aera/cmd" -> {
                val cmd = String(event.data).trim()
                WearBridgePlugin.emitCmd(cmd)
            }
            "/aera/battery" -> {
                val pct = String(event.data).trim().toIntOrNull() ?: return
                WearBridgePlugin.emitBattery(pct)
            }
        }
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val path = event.dataItem.uri.path.orEmpty()
            if (path.startsWith("/aera/plan/")) {
                val json = DataMap.fromByteArray(event.dataItem.data ?: continue).getString(PLAN_JSON_KEY)
                if (json != null) WearBridgePlugin.emitPlanChanged(json)
            } else if (path.startsWith("/aera/workout/")) {
                handleWorkoutItem(event.dataItem)
            }
        }
        dataEvents.release()
    }

    /** Reads the workout JSON out of the DataItem's Asset, always persists it to
     * filesDir/pending-workouts (survives the app being closed), and also emits
     * it live when the Capacitor bridge is up. */
    private fun handleWorkoutItem(item: DataItem) {
        val id = item.uri.lastPathSegment ?: return
        // Assets live beside the item, not in item.data: DataMap.fromByteArray(data)
        // can't resolve them ("Index 0 out of bounds"), so no watch run ever imported.
        val asset = DataMapItem.fromDataItem(item).dataMap.getAsset(WORKOUT_ASSET_KEY) ?: return
        val ctx = applicationContext
        Thread {
            try {
                val fd = Tasks.await(Wearable.getDataClient(ctx).getFdForAsset(asset))
                val json = fd.inputStream.use { it.readBytes() }.toString(Charsets.UTF_8)
                val dir = pendingWorkoutsDir(ctx)
                dir.mkdirs()
                File(dir, "$id.json").writeText(json)
                WearBridgePlugin.emitWorkoutReceived(json)
            } catch (e: Exception) {
                Log.w("WearBridge", "handleWorkoutItem failed: ${e.message}")
            }
        }.start()
    }
}
