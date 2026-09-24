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
import android.os.SystemClock
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
import java.time.Instant
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
 * Auto-pause follows the phone engine's rule: off during time/manual steps (standing
 * still in a warm-up or timed recovery must keep the clock running), on for distance/
 * either steps and free runs — toggled per step via overrideAutoPauseAndResume….
 */
class ExerciseService : Service() {
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val exerciseClient by lazy { HealthServices.getClient(this).exerciseClient }

    private var runner: PlanRunner? = null
    private var sport: String = "run"
    private var maxHr: Int = Zones.DEFAULT_MAX_HR
    private val zoneGuard = ZoneGuard()
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

    // HR samples for F7's zone-seconds strip — kept separate from `points` since GPS fixes
    // are often sparse/partial (see docs memory on Samsung workout data) but HR ticks every update.
    private val hrSamples = mutableListOf<Pair<Long, Int>>()

    // F8 lap card: current open lap's start + running HR average.
    private var lapStartMs = 0L
    private var lapStartDist = 0.0
    private var lapHrSum = 0L
    private var lapHrCount = 0
    private var lapIndex = 0
    private var prevLapSec: Int? = null

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
                val (steps, autoFinish, jsonMaxHr) = PlanRunner.fromJson(JSONObject(planJson))
                if (jsonMaxHr != null && jsonMaxHr > 0) maxHr = jsonMaxHr
                if (steps.isNotEmpty()) {
                    runner = PlanRunner(steps, autoFinish)
                    lapMeta.add(steps[0].kind to steps[0].label)
                    RecState.stepLabel = steps[0].label
                    RecState.stepKind = steps[0].kind
                    RecState.stepTotal = steps.size
                    RecState.targetZone = steps[0].hrZone ?: 0
                }
            } catch (e: Exception) {
                Log.w(TAG, "bad plan json: ${e.message}")
            }
        }
        RecState.maxHr = maxHr
        workoutId = UUID.randomUUID().toString()
        startedAtMs = System.currentTimeMillis()
        RecState.running = true
        if (!startForegroundNotification()) {
            // Background FGS start refused (Android 12+): hand off to a tap-to-start
            // notification rather than crashing.
            PhoneListener.postStartNotification(this, sport, planJson)
            workoutId = ""
            RecState.running = false
            stopSelf()
            return START_NOT_STICKY
        }
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
                supportsAutoPause = typeCaps.supportsAutoPauseAndResume
                val wanted = setOf(DataType.HEART_RATE_BPM, DataType.DISTANCE_TOTAL, DataType.LOCATION, DataType.SPEED)
                val dataTypes = wanted.filter { it in typeCaps.supportedDataTypes }.toSet()
                val config = ExerciseConfig.builder(exerciseType)
                    .setDataTypes(dataTypes)
                    .setIsAutoPauseAndResumeEnabled(
                        typeCaps.supportsAutoPauseAndResume && PlanRunner.autoPauseWanted(runner),
                    )
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
        // Screen off, Health Services batches samples (one update can carry minutes of
        // data). Consume every sample at its own time — taking only the last one left
        // GPS points minutes apart (straight lines across the track) and stepped HR.
        val nowMs = System.currentTimeMillis()
        val bootInstant = Instant.ofEpochMilli(nowMs - SystemClock.elapsedRealtime())
        fun activeAt(sampleMs: Long) = (activeMs - (nowMs - sampleMs)).coerceIn(0L, activeMs)
        val hrBatch = update.latestMetrics.getData(DataType.HEART_RATE_BPM)
            .filter { it.value > 0 }
            .map { activeAt(it.getTimeInstant(bootInstant).toEpochMilli()) to it.value.toInt() }
        val speeds = update.latestMetrics.getData(DataType.SPEED)
        val speed = speeds.lastOrNull()?.value
        var hi = 0
        for (loc in update.latestMetrics.getData(DataType.LOCATION)) {
            val t = activeAt(loc.getTimeInstant(bootInstant).toEpochMilli())
            while (hi < hrBatch.size && hrBatch[hi].first <= t) {
                recordHr(hrBatch[hi].first, hrBatch[hi].second)
                hi++
            }
            if (points.isNotEmpty() && t <= points.last().t) continue // out-of-order/duplicate fix
            val v = loc.value
            points.add(
                RecPoint(
                    t = t,
                    lat = v.latitude,
                    lng = v.longitude,
                    alt = v.altitude.takeIf { it > -1000.0 && it < 10000.0 },
                    hr = lastHr.takeIf { it > 0 },
                    speed = speeds.minByOrNull { kotlin.math.abs(it.timeDurationFromBoot.toMillis() - loc.timeDurationFromBoot.toMillis()) }?.value,
                ),
            )
        }
        while (hi < hrBatch.size) {
            recordHr(hrBatch[hi].first, hrBatch[hi].second)
            hi++
        }

        RecState.elapsedSec = (activeMs / 1000).toInt()
        RecState.distanceM = distanceM
        RecState.hr = lastHr
        RecState.autoPaused = state == ExerciseState.AUTO_PAUSED
        RecState.paused = state.isPaused

        val targetZone = (runner?.currentStep?.hrZone ?: 0).takeIf { it > 0 }
        RecState.targetZone = targetZone ?: 0
        val zGuardPaused = state.isPaused || state == ExerciseState.AUTO_PAUSED
        val zEvent = zoneGuard.sample(activeMs, lastHr, targetZone, maxHr, zGuardPaused)
        RecState.zoneStatus = zoneGuard.status.name.lowercase()
        if (zEvent != null) vibrateZone(zEvent)
        // speed m/s -> pace sec/km; 0/negative/absent speed (stopped or unsupported) reports no pace.
        RecState.paceSecPerKm = if (speed != null && speed > 0.3) (1000.0 / speed).toInt() else 0

        runner?.let { r ->
            val prevLabel = r.currentStep.label
            val changed = r.onUpdate(activeMs, distanceM)
            RecState.stepLabel = r.currentStep.label
            RecState.stepKind = r.currentStep.kind
            RecState.stepIndex = r.stepIndex
            RecState.remainingSec = r.remainingSec(activeMs)
            RecState.stepFraction = r.stepFraction(activeMs, distanceM)
            RecState.stepRemainingM = r.remainingM(distanceM)
            RecState.stepTargetM = r.currentStep.target.m
            RecState.stepKindIndex = r.currentStep.kindIndex
            RecState.stepKindTotal = r.currentStep.kindTotal
            RecState.nextStepLabel = r.nextStepLabel() ?: ""
            RecState.complete = r.complete
            if (changed) onStepChanged(r, activeMs, prevLabel)
        }
        maybePersist()
    }

    private var supportsAutoPause = false

    /** Re-apply the per-step auto-pause rule (see class doc) after a step change. */
    private fun applyAutoPauseForStep() {
        if (!supportsAutoPause) return
        val wanted = PlanRunner.autoPauseWanted(runner)
        scope.launch {
            try {
                exerciseClient.overrideAutoPauseAndResumeForActiveExerciseAsync(wanted).get()
            } catch (e: Exception) {
                Log.w(TAG, "auto-pause override failed: ${e.message}")
            }
        }
    }

    private fun onStepChanged(r: PlanRunner, activeMs: Long, endedStepLabel: String) {
        lapStartsMs.add(activeMs)
        if (!r.complete) lapMeta.add(r.currentStep.kind to r.currentStep.label)
        closeLap(activeMs, distanceM, trigger = endedStepLabel)
        zoneGuard.reset() // new step (or plan end) → target changed, timers restart
        applyAutoPauseForStep()
        vibrate(if (r.complete) "done" else r.currentStep.kind)
        if (r.complete && r.autoFinish) {
            exerciseClient.endExerciseAsync()
        }
    }

    /** Closes the current open lap and publishes it to RecState.lastLap for the F8 3 s card. */
    private fun closeLap(nowMs: Long, distanceNow: Double, trigger: String) {
        lapIndex++
        val lapSec = ((nowMs - lapStartMs) / 1000).toInt()
        val deltaSec = RunMath.lapDeltaSec(lapSec, prevLapSec)
        val avgHr = if (lapHrCount > 0) (lapHrSum / lapHrCount).toInt() else 0
        RecState.lastLap = RecState.LapInfo(
            n = lapIndex,
            label = "Lap $lapIndex",
            lapSec = lapSec,
            deltaSec = deltaSec,
            distanceM = distanceNow - lapStartDist,
            avgHr = avgHr,
            trigger = trigger,
        )
        RecState.lastLapAtMs = System.currentTimeMillis()
        prevLapSec = lapSec
        lapStartMs = nowMs
        lapStartDist = distanceNow
        lapHrSum = 0L
        lapHrCount = 0
    }

    // --- Controls called from RecordActivity ---

    private fun doPause() {
        scope.launch { try { exerciseClient.pauseExerciseAsync().get() } catch (_: Exception) {} }
    }

    private fun doResume() {
        scope.launch { try { exerciseClient.resumeExerciseAsync().get() } catch (_: Exception) {} }
    }

    /** Lap/Next button (on-screen Lap, or a guarded stem key — see RecordActivity.onKeyDown):
     * advances a manual plan step, else just marks a lap boundary. */
    private fun doLapOrNext() {
        val r = runner
        if (r != null && !r.complete) {
            val prevLabel = r.currentStep.label
            val changed = r.next(lastActiveMs, distanceM)
            RecState.stepLabel = r.currentStep.label
            RecState.stepKind = r.currentStep.kind
            RecState.stepIndex = r.stepIndex
            RecState.complete = r.complete
            if (changed) onStepChanged(r, lastActiveMs, prevLabel)
        } else {
            lapStartsMs.add(lastActiveMs)
            closeLap(lastActiveMs, distanceM, trigger = "Lap button")
            vibrate("lap")
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
        try {
            workoutsDir().mkdirs()
            File(workoutsDir(), "$workoutId.json").writeText(buildWorkoutJson().toString())
            File(workoutsDir(), "inprogress-$workoutId.json").delete()
        } catch (e: Exception) {
            Log.w(TAG, "finishAndSave failed: ${e.message}")
        }
        val durationSec = (lastActiveMs / 1000).toInt()
        RecState.sumWorkoutId = workoutId
        RecState.sumDistanceM = distanceM
        RecState.sumDurationSec = durationSec
        RecState.sumAvgPaceSecPerKm = RunMath.avgPaceSecPerKm(distanceM, durationSec)
        RecState.sumAvgHr = if (hrSamples.isNotEmpty()) (hrSamples.sumOf { it.second } / hrSamples.size) else 0
        RecState.sumZoneSecs = Zones.zoneSeconds(hrSamples)
        RecState.syncState = "pending"
        RecState.summaryReady = true
        // Last: RecordActivity closes when running goes false without a summary ready.
        RecState.running = false
        // Plain Thread, not `scope`: stopSelf() below tears the service (and scope)
        // down shortly after, which would cancel a coroutine mid-upload. Matches
        // the Thread{}.start() pattern the rest of the Data Layer calls use.
        val id = workoutId
        val ctx = applicationContext
        Thread { WorkoutSync.upload(ctx, id) }.start()
    }

    private fun recordHr(t: Long, bpm: Int) {
        if (hrSamples.isNotEmpty() && t < hrSamples.last().first) return
        lastHr = bpm
        hrSamples.add(t to bpm)
        lapHrSum += bpm
        lapHrCount++
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

    /** False if the system refused the foreground start (e.g. from background). */
    private fun startForegroundNotification(): Boolean {
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

        return try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(2, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(2, notif)
            }
            true
        } catch (e: Exception) {
            Log.w(TAG, "startForeground refused: ${e.message}")
            false
        }
    }

    /** Zone-guard alert: high = 2 short (slow down), low = 1 long (speed up),
     * back = 1 very short tick. Matches PhoneListener's watch-side patterns. */
    private fun vibrateZone(event: ZoneEvent) {
        vibrate(
            when (event) {
                ZoneEvent.HIGH -> "zone-high"
                ZoneEvent.LOW -> "zone-low"
                ZoneEvent.BACK -> "zone-back"
            },
        )
    }

    private fun vibrate(kind: String) {
        val v = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(VIBRATOR_SERVICE) as? Vibrator
        } ?: return
        val pattern = when (kind) {
            "work", "run" -> longArrayOf(0, 220, 120, 220)
            "recovery", "walk" -> longArrayOf(0, 120)
            "done" -> longArrayOf(0, 400)
            "lap" -> longArrayOf(0, 60, 60, 60)
            "zone-high" -> longArrayOf(0, 150, 120, 150) // slow down: 2 short
            "zone-low" -> longArrayOf(0, 500) // speed up: 1 long
            "zone-back" -> longArrayOf(0, 40) // back in zone: 1 very short tick
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
