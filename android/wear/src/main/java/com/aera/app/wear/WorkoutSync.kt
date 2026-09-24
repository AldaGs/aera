package com.aera.app.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import java.io.File

private const val TAG = "aera-wear"
private const val WORKOUT_PATH_PREFIX = "/aera/workout/"
private const val WORKOUT_ASSET_KEY = "json"

/**
 * Uploads standalone watch recordings (ExerciseService.finishAndSave's
 * filesDir/workouts/{id}.json) to the phone as DataItems (Phase 5). The JSON
 * goes in as an Asset since a track can exceed the 100 KB DataItem limit.
 * Ack (delete the local file + DataItem) is driven by PhoneListener's
 * /aera/workoutack handler; until then the file's mere presence marks it
 * pending, so [retryPending] just re-puts everything still on disk.
 */
object WorkoutSync {
    /** Ids of workout files not yet acked (finished, pending or mid-upload). */
    fun pendingIds(context: Context): List<String> =
        pendingIdsFromNames(workoutsDir(context).list()?.toList() ?: emptyList())

    /** Re-put every pending workout file. Idempotent — same URI just overwrites. */
    fun retryPending(context: Context) {
        for (id in pendingIds(context)) upload(context, id)
    }

    /** Upload one finished workout by id (called right after finishAndSave, and on retry). */
    fun upload(context: Context, id: String) {
        val file = File(workoutsDir(context), "$id.json")
        if (!file.exists()) {
            Log.w(TAG, "upload $id: no file")
            return
        }
        if (RecState.sumWorkoutId == id) RecState.syncState = "syncing"
        try {
            val req = PutDataMapRequest.create(WORKOUT_PATH_PREFIX + id)
            req.dataMap.putAsset(WORKOUT_ASSET_KEY, Asset.createFromBytes(file.readBytes()))
            req.setUrgent()
            Tasks.await(Wearable.getDataClient(context).putDataItem(req.asPutDataRequest()))
            Log.d(TAG, "uploaded workout $id (${file.length()} bytes)")
        } catch (e: Exception) {
            Log.w(TAG, "upload $id failed: ${e.message}")
        }
    }

    private fun workoutsDir(context: Context) = File(context.filesDir, "workouts")
}

/** Pure: finished-but-unacked workout ids from a workouts/ dir listing — a
 * finished file is "{id}.json"; "inprogress-{id}.json" is still recording. */
fun pendingIdsFromNames(names: List<String>): List<String> =
    names
        .filter { it.endsWith(".json") && !it.startsWith("inprogress-") }
        .map { it.removeSuffix(".json") }
