package com.aera.app

import android.net.Uri
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.io.File

private const val PLAN_PATH_PREFIX = "/aera/plan/"
private const val PLAN_JSON_KEY = "json"
private const val WORKOUT_PATH_PREFIX = "/aera/workout/"

/** Where watch workouts land when the Capacitor bridge isn't alive to receive
 * them live (see WearMessageListener.onDataChanged) — drained via [getPendingWorkouts]. */
fun pendingWorkoutsDir(ctx: android.content.Context) = File(ctx.filesDir, "pending-workouts")

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

        fun emitCadence(cad: Int) {
            val p = instance ?: return
            val data = JSObject()
            data.put("cad", cad)
            p.notifyListeners("cadence", data)
        }

        fun emitCmd(cmd: String) {
            val p = instance ?: return
            val data = JSObject()
            data.put("cmd", cmd)
            p.notifyListeners("cmd", data)
        }

        /** Called from [WearMessageListener] when an `/aera/plan/{id}` DataItem changes. */
        fun emitPlanChanged(json: String) {
            val p = instance ?: return
            val data = JSObject()
            data.put("json", json)
            p.notifyListeners("planChanged", data)
        }

        /** Called from [WearMessageListener] when an `/aera/battery` reply arrives. */
        fun emitBattery(pct: Int) {
            val p = instance ?: return
            val data = JSObject()
            data.put("battery", pct)
            p.notifyListeners("battery", data)
        }

        /** Called from [WearMessageListener] when a watch workout DataItem arrives
         * and the bridge is alive (Phase 5). */
        fun emitWorkoutReceived(json: String) {
            val p = instance ?: return
            val data = JSObject()
            data.put("json", json)
            p.notifyListeners("workoutReceived", data)
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
            .put("targetZone", call.getInt("targetZone", 0) ?: 0)
            .put("maxHr", call.getInt("maxHr", 0) ?: 0)
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

    /**
     * Standalone start: sends `/aera/startwatch` with `{sport, plan?}` and resolves
     * whether a node was actually reachable (unlike the fire-and-forget [send] helper,
     * the caller needs to know this to show an error in the New run sheet).
     */
    @PluginMethod
    fun startOnWatch(call: PluginCall) {
        val sport = call.getString("sport") ?: "run"
        val json = call.getString("json")
        val payload = JSONObject().put("sport", sport)
        if (json != null) {
            try {
                payload.put("plan", JSONObject(json))
            } catch (e: Exception) {
                call.reject("invalid plan json: ${e.message}")
                return
            }
        }
        val ctx = context
        Thread {
            val sent = try {
                val nodes = Tasks.await(Wearable.getNodeClient(ctx).connectedNodes)
                if (nodes.isEmpty()) {
                    false
                } else {
                    val mc = Wearable.getMessageClient(ctx)
                    for (n in nodes) Tasks.await(mc.sendMessage(n.id, "/aera/startwatch", payload.toString().toByteArray()))
                    true
                }
            } catch (e: Exception) {
                Log.w("WearBridge", "startOnWatch failed: ${e.message}")
                false
            }
            val res = JSObject()
            res.put("sent", sent)
            call.resolve(res)
        }.start()
    }

    /** Ask the watch to reply with its battery level (`/aera/battery`). */
    @PluginMethod
    fun pingWatch(call: PluginCall) {
        send("/aera/ping", ByteArray(0))
        call.resolve()
    }

    /** Write/replace the DataItem for one plan (id read out of the JSON). */
    @PluginMethod
    fun putPlan(call: PluginCall) {
        val json = call.getString("json")
        if (json == null) {
            call.reject("json is required")
            return
        }
        val id = try {
            JSONObject(json).getString("id")
        } catch (e: Exception) {
            call.reject("invalid plan json: ${e.message}")
            return
        }
        val ctx = context
        Thread {
            try {
                val req = PutDataMapRequest.create(PLAN_PATH_PREFIX + id)
                req.dataMap.putString(PLAN_JSON_KEY, json)
                req.setUrgent()
                Tasks.await(Wearable.getDataClient(ctx).putDataItem(req.asPutDataRequest()))
                call.resolve()
            } catch (e: Exception) {
                Log.w("WearBridge", "putPlan failed: ${e.message}")
                call.reject("putPlan failed: ${e.message}")
            }
        }.start()
    }

    /** Read every synced plan DataItem, as raw JSON strings. */
    @PluginMethod
    fun getAllPlans(call: PluginCall) {
        val ctx = context
        Thread {
            try {
                val uri = Uri.Builder().scheme("wear").path(PLAN_PATH_PREFIX).build()
                val items = Tasks.await(
                    Wearable.getDataClient(ctx).getDataItems(uri, DataClient.FILTER_PREFIX),
                )
                val plans = JSArray()
                for (i in 0 until items.count) {
                    val item = items[i]
                    val json = DataMap.fromByteArray(item.data ?: continue).getString(PLAN_JSON_KEY)
                    if (json != null) plans.put(json)
                }
                items.release()
                val res = JSObject()
                res.put("plans", plans)
                call.resolve(res)
            } catch (e: Exception) {
                Log.w("WearBridge", "getAllPlans failed: ${e.message}")
                val res = JSObject()
                res.put("plans", JSArray())
                call.resolve(res)
            }
        }.start()
    }

    /** Watch workouts persisted to disk (Phase 5) because the bridge wasn't alive
     * when they arrived — drained on app start / 'workoutReceived' miss. */
    @PluginMethod
    fun getPendingWorkouts(call: PluginCall) {
        val ctx = context
        Thread {
            val arr = JSArray()
            pendingWorkoutsDir(ctx).listFiles()
                ?.filter { it.name.endsWith(".json") }
                ?.forEach { f ->
                    try {
                        val o = JSObject()
                        o.put("json", f.readText())
                        arr.put(o)
                    } catch (e: Exception) {
                        Log.w("WearBridge", "read pending workout failed: ${e.message}")
                    }
                }
            val res = JSObject()
            res.put("workouts", arr)
            call.resolve(res)
        }.start()
    }

    /** A watch workout was imported: drop the pending file, delete the DataItem,
     * and tell the watch (`/aera/workoutack`) so it clears its own copy. */
    @PluginMethod
    fun ackWorkout(call: PluginCall) {
        val id = call.getString("id")
        if (id == null) {
            call.reject("id is required")
            return
        }
        val ctx = context
        Thread {
            File(pendingWorkoutsDir(ctx), "$id.json").delete()
            try {
                val uri = Uri.Builder().scheme("wear").path(WORKOUT_PATH_PREFIX + id).build()
                Tasks.await(Wearable.getDataClient(ctx).deleteDataItems(uri))
            } catch (e: Exception) {
                Log.w("WearBridge", "delete workout DataItem failed: ${e.message}")
            }
            try {
                val nodes = Tasks.await(Wearable.getNodeClient(ctx).connectedNodes)
                val mc = Wearable.getMessageClient(ctx)
                for (n in nodes) Tasks.await(mc.sendMessage(n.id, "/aera/workoutack", id.toByteArray()))
            } catch (e: Exception) {
                Log.w("WearBridge", "workoutack send failed: ${e.message}")
            }
            call.resolve()
        }.start()
    }
}
