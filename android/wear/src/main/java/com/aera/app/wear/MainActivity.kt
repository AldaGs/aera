package com.aera.app.wear

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Text
import com.aera.app.wear.ui.theme.AeraTheme
import com.aera.app.wear.ui.theme.Nocturne
import kotlinx.coroutines.delay

/**
 * Launcher screen (F10.3, restyled from Views to Compose): a live HR number +
 * step mirror from [AeraState] (500 ms poll, same cadence as the old View code),
 * Start/Stop for HrService, and a "Plans" chip.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            AeraTheme {
                MainScreen(
                    onToggle = { toggleMeasuring() },
                    onPlans = { startActivity(Intent(this, PlansActivity::class.java)) },
                )
            }
        }
        ensurePermissions()
    }

    override fun onResume() {
        super.onResume()
        // Phase 2 verification: confirms plan DataItems reached the watch.
        Thread { android.util.Log.d("aera-wear", "synced plans: ${PlanStore.listPlans(this).size}") }.start()
        // Phase 5: retry any standalone recordings the phone hasn't acked yet.
        Thread { WorkoutSync.retryPending(this) }.start()
    }

    private fun toggleMeasuring() {
        val intent = Intent(this, HrService::class.java)
        if (AeraState.measuring) {
            stopService(intent)
            sendCmd("stop")
        } else if (hasBodySensors()) {
            ContextCompat.startForegroundService(this, intent)
            sendCmd("start")
        } else {
            ensurePermissions()
        }
    }

    private fun sendCmd(cmd: String) {
        Thread { WearCmd.send(this, cmd) }.start()
    }

    private fun hasBodySensors() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.BODY_SENSORS) == PackageManager.PERMISSION_GRANTED

    private fun ensurePermissions() {
        val needed = mutableListOf<String>()
        if (!hasBodySensors()) needed.add(Manifest.permission.BODY_SENSORS)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            needed.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (needed.isNotEmpty()) requestPermissions(needed.toTypedArray(), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1 && hasBodySensors()) {
            ContextCompat.startForegroundService(this, Intent(this, HrService::class.java))
            sendCmd("start")
        }
    }
}

@Composable
private fun MainScreen(onToggle: () -> Unit, onPlans: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val vibrator = remember { context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as Vibrator }

    var hr by remember { mutableIntStateOf(0) }
    var stepLabel by remember { mutableStateOf("") }
    var remaining by remember { mutableIntStateOf(0) }
    var measuring by remember { mutableStateOf(false) }
    var lastVibratedSec by remember { mutableIntStateOf(-1) }

    LaunchedEffect(Unit) {
        while (true) {
            hr = AeraState.hr
            stepLabel = AeraState.stepLabel
            remaining = AeraState.remainingNow()
            measuring = AeraState.measuring
            if (remaining in 1..5 && remaining != lastVibratedSec) {
                lastVibratedSec = remaining
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
                } else vibrator.vibrate(100)
            } else if (remaining <= 0 || remaining > 5) {
                lastVibratedSec = -1
            }
            delay(500)
        }
    }

    Box(Modifier.fillMaxSize().background(Nocturne.ground).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (stepLabel.isNotEmpty()) {
                Text(stepLabel, color = Nocturne.accent400, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(2.dp))
            }
            Row(verticalAlignment = Alignment.Bottom) {
                Text(if (hr > 0) "$hr" else "--", color = Nocturne.text, fontSize = 56.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(4.dp))
                Text("bpm", color = Nocturne.neutral500, fontSize = 14.sp, modifier = Modifier.padding(bottom = 10.dp))
            }
            if (stepLabel.isNotEmpty() && remaining > 0) {
                Text("${remaining}s", color = Nocturne.accent300, fontSize = 16.sp, fontWeight = FontWeight.Medium)
            }
            Spacer(Modifier.height(12.dp))
            Chip(
                onClick = onToggle,
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.chipColors(backgroundColor = Nocturne.accent500, contentColor = Nocturne.ground),
                label = { Text(if (measuring) "Stop" else "Start", fontWeight = FontWeight.Medium) },
            )
            Spacer(Modifier.height(6.dp))
            Chip(
                onClick = onPlans,
                modifier = Modifier.fillMaxWidth(),
                colors = ChipDefaults.chipColors(backgroundColor = Nocturne.accent900, contentColor = Nocturne.text),
                label = { Text("Plans", fontWeight = FontWeight.Medium) },
            )
        }
    }
}
