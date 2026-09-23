package com.aera.app.wear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/**
 * Watch-side "Quick goal" editor: Time / Distance / Either (first-of), adjusted
 * with +/- buttons (no keyboard on a watch). Saves a 1-step IntervalPlan via
 * PlanStore (syncs to the phone like any authored plan) and starts it.
 */
class QuickGoalActivity : Activity() {
    private enum class GoalType { TIME, DISTANCE, EITHER }

    private var type = GoalType.TIME
    private var minutes = 30
    private var km = 5.0

    private lateinit var timeValue: TextView
    private lateinit var distValue: TextView
    private lateinit var timeButtons: View
    private lateinit var distButtons: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_quick_goal)

        timeValue = findViewById(R.id.timeValue)
        distValue = findViewById(R.id.distValue)
        timeButtons = findViewById(R.id.timeButtons)
        distButtons = findViewById(R.id.distButtons)

        findViewById<Button>(R.id.typeTime).setOnClickListener { type = GoalType.TIME; render() }
        findViewById<Button>(R.id.typeDistance).setOnClickListener { type = GoalType.DISTANCE; render() }
        findViewById<Button>(R.id.typeEither).setOnClickListener { type = GoalType.EITHER; render() }

        findViewById<Button>(R.id.timeMinus5).setOnClickListener { addMinutes(-5) }
        findViewById<Button>(R.id.timeMinus1).setOnClickListener { addMinutes(-1) }
        findViewById<Button>(R.id.timePlus1).setOnClickListener { addMinutes(1) }
        findViewById<Button>(R.id.timePlus5).setOnClickListener { addMinutes(5) }

        findViewById<Button>(R.id.distMinus1).setOnClickListener { addKm(-1.0) }
        findViewById<Button>(R.id.distMinusHalf).setOnClickListener { addKm(-0.5) }
        findViewById<Button>(R.id.distPlusHalf).setOnClickListener { addKm(0.5) }
        findViewById<Button>(R.id.distPlus1).setOnClickListener { addKm(1.0) }

        findViewById<Button>(R.id.start).setOnClickListener { start() }

        render()
    }

    private fun addMinutes(delta: Int) {
        minutes = (minutes + delta).coerceIn(1, 600)
        render()
    }

    private fun addKm(delta: Double) {
        km = ((km + delta) * 10).let { Math.round(it) / 10.0 }.coerceIn(0.5, 200.0)
        render()
    }

    private fun render() {
        timeValue.text = "$minutes min"
        distValue.text = "${fmtKm(km)} km"
        timeButtons.visibility = if (type == GoalType.DISTANCE) View.GONE else View.VISIBLE
        timeValue.visibility = timeButtons.visibility
        distButtons.visibility = if (type == GoalType.TIME) View.GONE else View.VISIBLE
        distValue.visibility = distButtons.visibility
    }

    private fun fmtKm(v: Double): String =
        if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()

    private fun start() {
        val id = UUID.randomUUID().toString()
        val now = isoNow()
        val meters = Math.round(km * 1000)

        val work = JSONObject()
        val name: String
        when (type) {
            GoalType.TIME -> {
                work.put("type", "time").put("sec", minutes * 60)
                name = "$minutes min"
            }
            GoalType.DISTANCE -> {
                work.put("type", "distance").put("m", meters)
                name = "${fmtKm(km)} km"
            }
            GoalType.EITHER -> {
                work.put("type", "either").put("sec", minutes * 60).put("m", meters)
                name = "${fmtKm(km)} km or $minutes min"
            }
        }

        val plan = JSONObject()
            .put("id", id)
            .put("name", name)
            .put("sport", "run")
            .put("warmup", JSONObject.NULL)
            .put("work", work)
            .put("recovery", JSONObject.NULL)
            .put("repeats", 1)
            .put("cooldown", JSONObject.NULL)
            .put("autoFinish", true)
            .put("createdAt", now)
            .put("updatedAt", now)

        Thread {
            val planJson = plan.toString()
            PlanStore.putPlan(this, planJson)
            val sent = WearCmd.send(this, "start:$planJson")
            Handler(Looper.getMainLooper()).post {
                if (sent) {
                    ContextCompat.startForegroundService(this, Intent(this, HrService::class.java))
                    finish()
                } else {
                    val intent = Intent(this, RecordActivity::class.java)
                    intent.putExtra(RecordActivity.EXTRA_SPORT, RecordActivity.sportOf(planJson))
                    intent.putExtra(RecordActivity.EXTRA_PLAN_JSON, planJson)
                    startActivity(intent)
                    finish()
                }
            }
        }.start()
    }

    private fun isoNow(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }
}
