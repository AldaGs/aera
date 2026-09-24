package com.aera.app.wear

import org.junit.Assert.assertEquals
import org.junit.Test

class WorkoutSyncTest {
    @Test
    fun pendingIdsSkipsInProgressAndNonJson() {
        val names = listOf("abc.json", "inprogress-abc.json", "def.json", "notes.txt")
        assertEquals(listOf("abc", "def"), pendingIdsFromNames(names))
    }

    @Test
    fun pendingIdsIsEmptyForEmptyDir() {
        assertEquals(emptyList<String>(), pendingIdsFromNames(emptyList()))
    }
}
