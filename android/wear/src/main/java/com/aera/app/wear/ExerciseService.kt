package com.aera.app.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.health.services.client.ExerciseUpdateCallback
import androidx.health.services.client.HealthServices
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.ExerciseConfig
import androidx.health.services.client.data.ExerciseLapSummary
import androidx.health.services.client.data.ExerciseState
import androidx.health.services.client.data.ExerciseType
import androidx.health.services.client.data.ExerciseUpdate
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

private const val TAG = "aera-wear"

/**
 * Standalone recording: Health Services ExerciseClient supplies HR/GPS/distance/duration
 * and (where supported) exercise-wide auto-pause, so there's no per-sample engine port
 * here — see docs/PLAN-goals-and-watch.md Phase 4. [PlanRunner] mirrors the phone's
 * step-advance rules (src/record/engine.ts checkPlanAdvance/advanceStep) on top of the
 * active-duration/distance the client reports.
 *
 * ponytail: Health Services auto-pause is exercise-wide, unlike the phone engine which
 * disables it during timed steps (recovery must keep ticking). Replicating that gating
 * would mean overriding auto-pause on every plan step transition; accepted as a Phase 4
 * limitation — upgrade if standalone recovery-step auto-pause turns out to matter.
 */
class ExerciseService : Service() {
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val exerciseClient by lazy { HealthServices.getClient(this).exerciseClient }

    private var runner: PlanRunner? = null
    private var sport: String = "run"
    private var workoutId: String = ""
    private var startedAtMs: Long = 0L
    private var distanceM: Double = 0.0
    private var lastHr: Int = 0
    private var lastActiveMs: Long = 0L
    private val points = mutableListOf<RecPoint>()
    private val lapStartsMs = mutableListOf(0L)
    private val lapMeta = mutableListOf<Pair<String, String>>() // kind, label
    private var lastPersistWall = 0L
    private var finished = false

    private data class RecPoint(
        val t: Long,
        val lat: Double,
        val lng: Double,
        val alt: Double?,
        val hr: Int?,
        val speed: Double?,
    )

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Null intent = system restart after process death: don't silently begin a new
        // exercise. A second start while recording must not reset the current one.
        if (intent == null || workoutId.isNotEmpty()) return START_NOT_STICKY
        RecState.reset()
        sport = intent.getStringExtra(EXTRA_SPORT) ?: "run"
        val planJson = intent.getStringExtra(EXTRA_PLAN_JSON)
        if (planJson != null) {
            try {
                val (steps, autoFinish) = PlanRunner.fromJson(JSONObject(planJson))
                if (steps.isNotEmpty()) {
                    runner = PlanRunner(steps, autoFinish)
                    lapMeta.add(steps[0].kind to steps[0].label)
                    RecState.stepLabel = steps[0].label
                    RecState.stepKind = steps[0].kind
                    RecState.stepTotal = steps.size
                }
            } catch (e: Exception) {
                Log.w(TAG, "bad plan json: ${e.message}")
            }
        }
        workoutId = UUID.randomUUID().toString()
        startedAtMs = System.currentTimeMillis()
        RecState.running = true
        startForegroundNotification()
        beginExercise()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        instance = null
        try {
            exerciseClient.clearUpdateCallbackAsync(updateCallback)
        } catch (_: Exception) {
        }
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun beginExercise() {
        scope.launch {
            try {
                val exerciseType = when (sport) {
                    "walk" -> ExerciseType.WALKING
                    "ride" -> ExerciseType.BIKING
                    else -> ExerciseType.RUNNING
                }
                // Blocking .get() in a background dispatcher — matches the Tasks.await()
                // style already used elsewhere in this module (WearCmd, PlanStore).
                val caps = exerciseClient.getCapabilitiesAsync().get()
                val typeCaps = caps.getExerciseTypeCapabilities(exerciseType)
                val wanted = setOf(DataType.HEART_RATE_BPM, DataType.DISTANCE_TOTAL, DataType.LOCATION, DataType.SPEED)
                val dataTypes = wanted.filter { it in typeCaps.supportedDataTypes }.toSet()
                val config = ExerciseConfig.builder(exerciseType)
                    .setDataTypes(dataTypes)
                    .setIsAutoPauseAndResumeEnabled(typeCaps.supportsAutoPauseAndResume)
                    .setIsGpsEnabled(DataType.LOCATION in dataTypes)
                    .build()
                exerciseClient.setUpdateCallback(mainExecutor, updateCallback)
                exerciseClient.startExerciseAsync(config).get()
            } catch (e: Exception) {
                Log.w(TAG, "startExercise failed: ${e.message}")
                stopSelf()
            }
        }
    }

    private val updateCallback = object : ExerciseUpdateCallback {
        override fun onRegistered() {}
        override fun onRegistrationFailed(throwable: Throwable) {
            Log.w(TAG, "registration failed: ${throwable.message}")
        }
        override fun onLapSummaryReceived(lapSummary: ExerciseLapSummary) {}
        override fun onAvailabilityChanged(dataType: DataType<*, *>, availability: Availability) {}
        override fun onExerciseUpdateReceived(update: ExerciseUpdate) = handleUpdate(update)
    }

    private fun handleUpdate(update: ExerciseUpdate) {
        val state = update.exerciseStateInfo.state
        if (state.isEnded) {
            if (!finished) finishAndSave()
            stopSelf()
            return
        }

        val checkpoint = update.activeDurationCheckpoint
        val activeMs = when {
            checkpoint == null -> 0L
            state.isPaused -> checkpoint.activeDuration.toMillis()
            else -> checkpoint.activeDuration.toMillis() + (System.currentTimeMillis() - checkpoint.time.toEpochMilli())
        }
        lastActiveMs = activeMs

        update.latestMetrics.getData(DataType.DISTANCE_TOTAL)?.let { distanceM = it.total }
        update.latestMetrics.getData(DataType.HEART_RATE_BPM).lastOrNull()?.let {
            val v = it.value.toInt()
            if (v > 0) lastHr = v
        }
        val speed = update.latestMetrics.getData(DataType.SPEED).lastOrNull()?.value
        update.latestMetrics.getData(DataType.LOCATION).lastOrNull()?.value?.let { loc ->
            points.add(
                RecPoint(
                    t = activeMs,
                    lat = loc.latitude,
                    lng = loc.longitude,
                    alt = loc.altitude.takeIf { it != -1000.0 && !it.isNaN() },
                    hr = lastHr.takeIf { it > 0 },
                    speed = speed,
                ),
            )
        }

        RecState.elapsedSec = (activeMs / 1000).toInt()
        RecState.distanceM = distanceM
        RecState.hr = lastHr
        RecState.autoPaused = state == ExerciseState.AUTO_PAUSED
        RecState.paused = state.isPaused

        runner?.let { r ->
            val changed = r.onUpdate(activeMs, distanceM)
            RecState.stepLabel = r.currentStep.label
            RecState.stepKind = r.currentStep.kind
            RecState.stepIndex = r.stepIndex
            RecState.remainingSec = r.remainingSec(activeMs)
            RecState.complete = r.complete
            if (changed) onStepChanged(r, activeMs)
        }
        maybePersist()
    }

    private fun onStepChanged(r: PlanRunner, activeMs: Long) {
        lapStartsMs.add(activeMs)
        if (!r.complete) lapMeta.add(r.currentStep.kind to r.currentStep.label)
        vibrate(if (r.complete) "done" else r.currentStep.kind)
        if (r.complete && r.autoFinish) {
            exerciseClient.endExerciseAsync()
        }
    }

    // --- Controls called from RecordActivity ---

    private fun doPause() {
        scope.launch { try { exerciseClient.pauseExerciseAsync().get() } catch (_: Exception) {} }
    }

    private fun doResume() {
        scope.launch { try { exerciseClient.resumeExerciseAsync().get() } catch (_: Exception) {} }
    }

    /** Lap/Next button: advances a manual plan step, else just marks a lap boundary. */
    private fun doLapOrNext() {
        val r = runner
        if (r != null && !r.complete) {
            val changed = r.next(lastActiveMs, distanceM)
            RecState.stepLabel = r.currentStep.label
            RecState.stepKind = r.currentStep.kind
            RecState.stepIndex = r.stepIndex
            RecState.complete = r.complete
            if (changed) onStepChanged(r, lastActiveMs)
        } else {
            lapStartsMs.add(lastActiveMs)
            scope.launch { try { exerciseClient.markLapAsync().get() } catch (_: Exception) {} }
        }
    }

    private fun doStop() {
        scope.launch { try { exerciseClient.endExerciseAsync().get() } catch (_: Exception) {} }
    }

    // --- Persistence: matches the phone's Workout import shape (id/sport/startTime/track/laps). ---

    private fun maybePersist() {
        val now = System.currentTimeMillis()
        if (now - lastPersistWall < 10_000) return
        lastPersistWall = now
        try {
            workoutsDir().mkdirs()
            File(workoutsDir(), "inprogress-$workoutId.json").writeText(buildWorkoutJson().toString())
        } catch (e: Exception) {
            Log.w(TAG, "persist failed: ${e.message}")
        }
    }

    private fun finishAndSave() {
        finished = true
        RecState.running = false
        try {
            workoutsDir().mkdirs()
            File(workoutsDir(), "$workoutId.json").writeText(buildWorkoutJson().toString())
            File(workoutsDir(), "inprogress-$workoutId.json").delete()
        } catch (e: Exception) {
            Log.w(TAG, "finishAndSave failed: ${e.message}")
        }
    }

    private fun workoutsDir() = File(filesDir, "workouts")

    private fun buildWorkoutJson(): JSONObject {
        val track = JSONArray()
        for (p in points) {
            track.put(
                JSONObject()
                    .put("t", p.t)
                    .put("lat", p.lat)
                    .put("lng", p.lng)
                    .put("alt", p.alt?.let { it } ?: JSONObject.NULL)
                    .put("hr", p.hr?.let { it } ?: JSONObject.NULL)
                    .put("cad", JSONObject.NULL)
                    .put("speed", p.speed?.let { it } ?: JSONObject.NULL)
                    .put("power", JSONObject.NULL),
            )
        }
        val laps = JSONArray()
        val bounds = lapStartsMs + lastActiveMs
        for (i in 0 until bounds.size - 1) {
            val meta = lapMeta.getOrNull(i)
            laps.put(
                JSONObject()
                    .put("startMs", bounds[i])
                    .put("endMs", bounds[i + 1])
                    .put("kind", meta?.first ?: "work")
                    .put("label", meta?.second ?: ""),
            )
        }
        return JSONObject()
            .put("id", workoutId)
            .put("sport", sport)
            .put("startedAt", isoAt(startedAtMs))
            .put("track", track)
            .put("laps", laps)
            .put(
                "summary",
                JSONObject()
                    .put("distanceM", distanceM)
                    .put("durationSec", lastActiveMs / 1000),
            )
    }

    private fun isoAt(ms: Long): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date(ms))
    }

    // --- Foreground notification (Ongoing Activity), same pattern as HrService. ---

    private fun startForegroundNotification() {
        val chanId = "aera_exercise"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(chanId, "aera recording", NotificationManager.IMPORTANCE_LOW),
            )
        }
        val intent = Intent(this, RecordActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, chanId)
            .setContentTitle("aera")
            .setContentText("Recording workout")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
        val notif = builder.build()

        try {
            OngoingActivity.Builder(this, 2, builder)
                .setStaticIcon(android.R.drawable.ic_menu_compass)
                .setTouchIntent(pendingIntent)
                .setStatus(Status.Builder().addTemplate("Recording").build())
                .build()
                .apply(this)
        } catch (_: Exception) {
        }

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(2, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(2, notif)
        }
    }

    private fun vibrate(kind: String) {
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(VIBRATOR_SERVICE) as? Vibrator
        } ?: return
        val pattern = when (kind) {
            "work" -> longArrayOf(0, 220, 120, 220)
            "recovery" -> longArrayOf(0, 120)
            "done" -> longArrayOf(0, 400)
            else -> longArrayOf(0, 180)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION") v.vibrate(pattern, -1)
        }
    }

    companion object {
        const val EXTRA_PLAN_JSON = "planJson"
        const val EXTRA_SPORT = "sport"

        @Volatile private var instance: ExerciseService? = null

        fun pause() = instance?.doPause()
        fun resume() = instance?.doResume()
        fun lapOrNext() = instance?.doLapOrNext()
        fun stop() = instance?.doStop()
        fun isRunning() = instance != null
    }
}
