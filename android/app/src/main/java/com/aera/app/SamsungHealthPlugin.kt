package com.aera.app

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Custom Capacitor plugin bridging the Samsung Health Data SDK.
 *
 * It returns exercise sessions shaped like the JS `HealthWorkout` interface, so
 * they reuse the same pure `mapHealthWorkout` mapper as the Health Connect path.
 *
 * ── Where on-device confirmation may be needed (use Android Studio autocomplete
 *    against the AAR to verify exact names/types; each is isolated below) ──
 *   [A] HealthDataPoint time accessors  (startTime / endTime)
 *   [B] DataType.ExerciseType field constants (EXERCISE_TYPE/DURATION/DISTANCE/
 *       CALORIES/MEAN_HEART_RATE) and their value types
 *   [C] Route + per-sample heart rate = "associated data"; left as TODO so the
 *       first build imports summary-level workouts, then we add the route read.
 */
@CapacitorPlugin(name = "SamsungHealth")
class SamsungHealthPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val store: HealthDataStore by lazy { HealthDataService.getStore(context) }
    private val readPerms = setOf(Permission.of(DataTypes.EXERCISE, AccessType.READ))

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        // Reaching here means the SDK classes linked. A deeper check (Samsung
        // Health installed / min version) can be added if needed.
        val res = JSObject()
        res.put("available", true)
        call.resolve(res)
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        scope.launch {
            try {
                var granted = store.getGrantedPermissions(readPerms)
                if (!granted.containsAll(readPerms)) {
                    store.requestPermissions(readPerms, activity)
                    granted = store.getGrantedPermissions(readPerms)
                }
                val res = JSObject()
                res.put("granted", granted.containsAll(readPerms))
                call.resolve(res)
            } catch (e: Exception) {
                call.reject(e.message ?: "permission error")
            }
        }
    }

    @PluginMethod
    fun readWorkouts(call: PluginCall) {
        val days = call.getInt("days", 90) ?: 90
        scope.launch {
            try {
                val end = LocalDateTime.now()
                val start = LocalDate.now().minusDays(days.toLong()).atStartOfDay()
                val request = DataTypes.EXERCISE.readDataRequestBuilder
                    .setLocalTimeFilter(LocalTimeFilter.of(start, end))
                    .build()

                val points = store.readData(request).dataList
                val arr = JSArray()

                for (p in points) {
                    val o = JSObject()

                    // [A] session time bounds
                    val startInstant = p.startTime
                    val endInstant = p.endTime
                    // Stable dedup id from the time bounds (uid accessor varies by
                    // SDK version; time bounds are reliable and unique enough).
                    o.put("id", "$startInstant" + "_" + "$endInstant")
                    o.put("startDate", startInstant.toString())
                    o.put("endDate", endInstant.toString())

                    // [B] summary fields — wrapped so one missing value won't drop
                    // the whole session; constant NAMES must still resolve at compile.
                    o.put("workoutType", exerciseTypeToString(getValueOrNull(p, DataType.ExerciseType.EXERCISE_TYPE)))
                    o.put("duration", toSeconds(getValueOrNull(p, DataType.ExerciseType.DURATION)))
                    o.put("distance", toDouble(getValueOrNull(p, DataType.ExerciseType.DISTANCE)))
                    o.put("calories", toDouble(getValueOrNull(p, DataType.ExerciseType.CALORIES)))

                    // [C] route + per-sample HR (associated data). Empty for now;
                    // the mapper handles routeless sessions (summary-level import).
                    o.put("route", JSArray())
                    o.put("heartRate", JSArray())

                    arr.put(o)
                }

                val res = JSObject()
                res.put("workouts", arr)
                call.resolve(res)
            } catch (e: Exception) {
                call.reject(e.message ?: "read error")
            }
        }
    }

    // --- helpers -------------------------------------------------------------

    private fun getValueOrNull(point: Any, field: Any): Any? {
        return try {
            // point.getValue(field) — reflection-free path relies on the SDK's
            // typed getValue; if a constant is wrong this line is where the
            // compiler points you.
            val m = point.javaClass.getMethod("getValue", field.javaClass.interfaces.firstOrNull() ?: field.javaClass)
            m.invoke(point, field)
        } catch (e: Exception) {
            null
        }
    }

    private fun toDouble(v: Any?): Double = when (v) {
        null -> 0.0
        is Number -> v.toDouble()
        is Duration -> v.seconds.toDouble()
        else -> v.toString().toDoubleOrNull() ?: 0.0
    }

    private fun toSeconds(v: Any?): Double = when (v) {
        is Duration -> v.seconds.toDouble()
        is Number -> v.toDouble() / 1000.0 // assume ms if a raw number
        else -> toDouble(v)
    }

    /** Map Samsung exercise-type codes to canonical strings the JS mapper reads. */
    private fun exerciseTypeToString(v: Any?): String {
        val code = (v as? Number)?.toInt() ?: return v?.toString() ?: "UNKNOWN"
        return when (code) {
            1002 -> "RUNNING"
            1001 -> "WALKING"
            11007 -> "CYCLING"
            13001 -> "HIKING"
            else -> "TYPE_$code"
        }
    }
}
