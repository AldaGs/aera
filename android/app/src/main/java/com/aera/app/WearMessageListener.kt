package com.aera.app

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

private const val PLAN_JSON_KEY = "json"

/**
 * Receives Data-Layer messages from the watch. `/aera/hr` etc. are messages,
 * forwarded to the Capacitor layer via [WearBridgePlugin]. `/aera/plan/{id}` items are
 * DataItems (edited on the watch, or arriving on reconnect) — each change is
 * forwarded as a `planChanged` event so JS can merge it in.
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
            if (!event.dataItem.uri.path.orEmpty().startsWith("/aera/plan/")) continue
            val json = DataMap.fromByteArray(event.dataItem.data ?: continue).getString(PLAN_JSON_KEY)
            if (json != null) WearBridgePlugin.emitPlanChanged(json)
        }
        dataEvents.release()
    }
}
