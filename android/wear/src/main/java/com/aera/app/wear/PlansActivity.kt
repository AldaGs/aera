package com.aera.app.wear

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Toast
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Plan list: "Quick goal" (opens the quick-goal editor) followed by every synced
 * plan (see PlanStore). Tapping a plan starts it on the phone via /aera/cmd.
 */
class PlansActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_plans)
        val list = findViewById<LinearLayout>(R.id.list)

        list.addView(rowButton(getString(R.string.quick_goal)) {
            startActivity(Intent(this, QuickGoalActivity::class.java))
        })

        Thread {
            val plans = PlanStore.listPlans(this)
            main.post {
                for (plan in plans) list.addView(rowButton(planLabel(plan)) { startPlan(plan) })
            }
        }.start()
    }

    private fun planLabel(plan: JSONObject): String {
        val name = plan.optString("name", "Plan")
        val repeats = plan.optInt("repeats", 1)
        return if (repeats > 1) "$name (${repeats}x)" else name
    }

    private fun rowButton(label: String, onClick: () -> Unit): Button {
        val btn = Button(this)
        btn.text = label
        btn.setBackgroundResource(R.drawable.btn_rounded)
        btn.setTextColor(0xFFFFFFFF.toInt())
        val params = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT,
        )
        params.topMargin = 8
        btn.layoutParams = params
        btn.setOnClickListener { onClick() }
        return btn
    }

    private fun startPlan(plan: JSONObject) {
        Thread {
            val sent = WearCmd.send(this, "start:" + plan.toString())
            main.post {
                if (!sent) {
                    Toast.makeText(this, R.string.phone_not_connected, Toast.LENGTH_SHORT).show()
                } else {
                    ContextCompat.startForegroundService(this, Intent(this, HrService::class.java))
                    finish()
                }
            }
        }.start()
    }
}
