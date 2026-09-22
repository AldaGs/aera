package com.aera.app.wear

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject

private const val PLAN_PATH_PREFIX = "/aera/plan/"
private const val PLAN_JSON_KEY = "json"

/**
 * The watch's plan "store": DataItems written by the phone (see WearBridgePlugin
 * on the phone side) are the source of truth, no local DB. Phase 3 authoring on
 * the watch will call [putPlan] to push a plan back; today this is read-only.
 */
object PlanStore {
    /** Non-deleted plans currently synced to this watch, as raw JSON objects. */
    fun listPlans(context: Context): List<JSONObject> {
        return try {
            val uri = Uri.Builder().scheme("wear").path(PLAN_PATH_PREFIX).build()
            val items = Tasks.await(
                Wearable.getDataClient(context).getDataItems(uri, DataClient.FILTER_PREFIX),
            )
            // DataItems are per-node (wear://<node>/aera/plan/id), so the phone's and the
            // watch's copy of a plan both show up here: keep the newest per id (LWW).
            val byId = mutableMapOf<String, JSONObject>()
            for (i in 0 until items.count) {
                val item = items[i]
                val json = DataMap.fromByteArray(item.data ?: continue).getString(PLAN_JSON_KEY) ?: continue
                val obj = try { JSONObject(json) } catch (e: Exception) { continue }
                val id = obj.optString("id")
                val cur = byId[id]
                if (cur == null || updatedAt(obj) > updatedAt(cur)) byId[id] = obj
            }
            items.release()
            byId.values.filter { !it.optBoolean("deleted", false) }
        } catch (e: Exception) {
            Log.w("aera-wear", "PlanStore.listPlans failed: ${e.message}")
            emptyList()
        }
    }

    private fun updatedAt(p: JSONObject): String = p.optString("updatedAt", p.optString("createdAt"))

    /** Write/replace the DataItem for one plan (for Phase 3 watch authoring). */
    fun putPlan(context: Context, json: String) {
        try {
            val id = JSONObject(json).getString("id")
            val req = PutDataMapRequest.create(PLAN_PATH_PREFIX + id)
            req.dataMap.putString(PLAN_JSON_KEY, json)
            req.setUrgent()
            Tasks.await(Wearable.getDataClient(context).putDataItem(req.asPutDataRequest()))
        } catch (e: Exception) {
            Log.w("aera-wear", "PlanStore.putPlan failed: ${e.message}")
        }
    }
}
