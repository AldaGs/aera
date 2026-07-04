package com.aera.app

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.util.Log
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Custom Capacitor plugin bridging the Samsung Health Data SDK.
 *
 * Returns exercise sessions shaped like the JS `HealthWorkout` interface, so they
 * reuse the same pure `mapHealthWorkout` mapper as the Health Connect path.
 *
 * The SDK model (verified against samsung-health-data-api 1.1.0):
 *   - `store.readData(EXERCISE request)` → List<HealthDataPoint>
 *   - each point's `getValue(DataType.ExerciseType.SESSIONS)` → List<ExerciseSession>
 *   - ExerciseSession carries typed summary + embedded route + per-sample log,
 *     so GPS route and heart rate come back in the same read (no separate call).
 */
@CapacitorPlugin(name = "SamsungHealth")
class SamsungHealthPlugin : Plugin() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val store: HealthDataStore by lazy { HealthDataService.getStore(context) }
    // EXERCISE alone returns sessions with an EMPTY route/log. The GPS route and
    // per-sample heart rate are gated behind their own read permissions (same as
    // Health Connect's separate ExerciseRoute grant), so request all three; then
    // ExerciseSession.getRoute()/getLog() populate.
    private val exercisePerm = Permission.of(DataTypes.EXERCISE, AccessType.READ)
    private val readPerms = setOf(
        exercisePerm,
        Permission.of(DataTypes.EXERCISE_LOCATION, AccessType.READ),
        Permission.of(DataTypes.HEART_RATE, AccessType.READ),
    )

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        // Reaching here means the SDK classes linked.
        val res = JSObject()
        res.put("available", true)
        call.resolve(res)
    }

    // Named to avoid clashing with Capacitor Plugin.requestPermissions(); the JS
    // bridge calls this explicit name.
    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        scope.launch {
            try {
                var granted = store.getGrantedPermissions(readPerms)
                if (!granted.containsAll(readPerms)) {
                    store.requestPermissions(readPerms, activity)
                    granted = store.getGrantedPermissions(readPerms)
                }
                // EXERCISE is required to import at all; EXERCISE_LOCATION + HEART_RATE
                // are best-effort (they enrich with route/HR but shouldn't block import).
                val res = JSObject()
                res.put("granted", granted.contains(exercisePerm))
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
                    val uid = p.uid
                    val sessions: List<ExerciseSession> =
                        p.getValue(DataType.ExerciseType.SESSIONS) ?: emptyList()

                    // Diagnostic: how many sessions per data point, and their types —
                    // helps explain "only 2 activities show" for interval runs.
                    Log.d(
                        "SamsungHealth",
                        "point uid=$uid sessions=${sessions.size} types=" +
                            sessions.joinToString { it.exerciseType.name },
                    )

                    // A data point can hold multiple sessions; emit one workout each,
                    // suffixing the uid so dedup keys stay unique.
                    sessions.forEachIndexed { i, s ->
                        val o = JSObject()
                        o.put("id", if (sessions.size > 1) "${uid}_$i" else uid)
                        o.put("startDate", s.startTime.toString())
                        o.put("endDate", s.endTime.toString())
                        o.put("workoutType", s.exerciseType.name) // RUNNING/WALKING/BIKING/HIKING…
                        o.put("duration", s.duration.seconds.toDouble())
                        o.put("distance", (s.distance ?: 0f).toDouble()) // meters
                        o.put("calories", s.calories.toDouble())          // kcal

                        // Session-level summary fields
                        try { o.put("meanCadence", (s.meanCadence ?: 0f).toDouble()) } catch (_: Exception) {}
                        try { o.put("maxCadence", (s.maxCadence ?: 0f).toDouble()) } catch (_: Exception) {}
                        try { o.put("meanSpeed", (s.meanSpeed ?: 0f).toDouble()) } catch (_: Exception) {}
                        try { o.put("maxSpeed", (s.maxSpeed ?: 0f).toDouble()) } catch (_: Exception) {}
                        try { o.put("vo2Max", (s.vo2Max ?: 0f).toDouble()) } catch (_: Exception) {}
                        // Session-level HR — authoritative over the per-sample log when
                        // the GPS route (and thus the attached HR track) is partial.
                        try { o.put("meanHeartRate", (s.meanHeartRate ?: 0f).toDouble()) } catch (_: Exception) {}
                        try { o.put("maxHeartRate", (s.maxHeartRate ?: 0f).toDouble()) } catch (_: Exception) {}

                        // Route (GPS) → [{ timestamp, lat, lng, alt? }]
                        val route = JSArray()
                        for (loc in s.route ?: emptyList()) {
                            val r = JSObject()
                            r.put("timestamp", loc.timestamp.toString())
                            r.put("lat", loc.latitude.toDouble())
                            r.put("lng", loc.longitude.toDouble())
                            loc.altitude?.let { r.put("alt", it.toDouble()) }
                            route.put(r)
                        }
                        o.put("route", route)

                        // Combined per-sample log with HR + speed + cadence + power
                        // → [{ timestamp, bpm?, speed?, cadence?, power? }]
                        // Per-sample log. NOTE (verified on-device via logcat): the
                        // SDK's ExerciseLog exposes HR only — no per-sample speed /
                        // cadence / interval tags — and ExerciseSession has no lap
                        // accessor. So interval/lap breakdowns aren't available via the
                        // Data SDK (they live only in Samsung's internal export files).
                        val logArr = JSArray()
                        for (log in s.log ?: emptyList()) {
                            val entry = JSObject()
                            entry.put("timestamp", log.timestamp.toString())
                            log.heartRate?.let { entry.put("bpm", it.toDouble()) }
                            log.speed?.let { entry.put("speed", it.toDouble()) }
                            log.cadence?.let { entry.put("cadence", it.toDouble()) }
                            log.power?.let { entry.put("power", it.toDouble()) }
                            logArr.put(entry)
                        }
                        o.put("log", logArr)

                        // Keep legacy heartRate array for backward compat
                        val hr = JSArray()
                        for (log in s.log ?: emptyList()) {
                            val bpm = log.heartRate ?: continue
                            val h = JSObject()
                            h.put("timestamp", log.timestamp.toString())
                            h.put("bpm", bpm.toDouble())
                            hr.put(h)
                        }
                        o.put("heartRate", hr)

                        arr.put(o)
                    }
                }

                val res = JSObject()
                res.put("workouts", arr)
                call.resolve(res)
            } catch (e: Exception) {
                call.reject(e.message ?: "read error")
            }
        }
    }
}
