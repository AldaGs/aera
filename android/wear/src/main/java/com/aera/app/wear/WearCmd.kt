package com.aera.app.wear

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Wearable

/** Shared `/aera/cmd` sender (was private to MainActivity; Phase 3 screens need it too). */
object WearCmd {
    /** Sends [cmd] to every connected node. Returns false if no node was connected. */
    fun send(context: Context, cmd: String): Boolean {
        return try {
            val nodes = Tasks.await(Wearable.getNodeClient(context).connectedNodes)
            if (nodes.isEmpty()) return false
            val mc = Wearable.getMessageClient(context)
            val payload = cmd.toByteArray()
            for (n in nodes) mc.sendMessage(n.id, "/aera/cmd", payload)
            true
        } catch (e: Exception) {
            false
        }
    }
}
