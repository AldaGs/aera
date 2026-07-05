package com.aera.app

import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Receives Data-Layer messages from the watch. Only `/aera/hr` (a bpm integer as
 * ASCII) is inbound; it's forwarded to the Capacitor layer via [WearBridgePlugin].
 */
class WearMessageListener : WearableListenerService() {
    override fun onMessageReceived(event: MessageEvent) {
        if (event.path == "/aera/hr") {
            val bpm = String(event.data).trim().toDoubleOrNull()?.toInt() ?: return
            WearBridgePlugin.emitHr(bpm)
        }
    }
}
