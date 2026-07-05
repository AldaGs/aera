package com.aera.app

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

/**
 * Phone-side bridge to the aera Wear OS companion over the Wearable Data Layer.
 * The watch streams live HR to us (`/aera/hr`, handled by [WearMessageListener]);
 * we push interval step / cue / stop messages back to it.
 */
@CapacitorPlugin(name = "WearBridge")
class WearBridgePlugin : Plugin() {

    companion object {
        @Volatile private var instance: WearBridgePlugin? = null

        /** Called from [WearMessageListener] when an `/aera/hr` message arrives. */
        fun emitHr(bpm: Int) {
            val p = instance ?: return
            val data = JSObject()
            data.put("bpm", bpm)
            p.notifyListeners("hr", data)
        }
    }

    override fun load() {
        instance = this
    }

    override fun handleOnDestroy() {
        if (instance === this) instance = null
    }

    /** Fire-and-forget send of a message to every connected node (off the UI thread). */
    private fun send(path: String, payload: ByteArray) {
        val ctx = context
        Thread {
            try {
                val nodes = Tasks.await(Wearable.getNodeClient(ctx).connectedNodes)
                val mc = Wearable.getMessageClient(ctx)
                for (n in nodes) Tasks.await(mc.sendMessage(n.id, path, payload))
            } catch (e: Exception) {
                Log.w("WearBridge", "send $path failed: ${e.message}")
            }
        }.start()
    }

    @PluginMethod
    fun isWatchConnected(call: PluginCall) {
        val ctx = context
        Thread {
            val connected = try {
                Tasks.await(Wearable.getNodeClient(ctx).connectedNodes).isNotEmpty()
            } catch (e: Exception) {
                false
            }
            val res = JSObject()
            res.put("connected", connected)
            call.resolve(res)
        }.start()
    }

    @PluginMethod
    fun sendStep(call: PluginCall) {
        val json = JSONObject()
            .put("label", call.getString("label") ?: "")
            .put("kind", call.getString("kind") ?: "")
            .put("remainingSec", call.getInt("remainingSec", 0) ?: 0)
        send("/aera/step", json.toString().toByteArray())
        call.resolve()
    }

    @PluginMethod
    fun sendCue(call: PluginCall) {
        send("/aera/cue", (call.getString("kind") ?: "").toByteArray())
        call.resolve()
    }

    @PluginMethod
    fun stopWatch(call: PluginCall) {
        send("/aera/stop", ByteArray(0))
        call.resolve()
    }
}
