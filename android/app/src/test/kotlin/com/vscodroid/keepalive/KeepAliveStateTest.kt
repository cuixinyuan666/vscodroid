package com.vscodroid.keepalive

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import io.mockk.verify
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/**
 * The one record that outlives the process, and the one property of it that
 * matters: that it is committed rather than applied.
 *
 * The state itself is two booleans on disk, and testing the round trip needs
 * a Context. What is worth a test is not the round trip but the write, for
 * the reason `NodeService.chargeHeapOverride` gives about `PREF_HEAP_KILLS`:
 * the event being recorded is the user asking for a server, and the process
 * death that makes the record matter often follows within seconds. `apply()`
 * writes from a background thread and loses that race; a regression to it
 * here is silent on every device that does not happen to kill the app in the
 * window, which is most of them.
 *
 * mockk rather than Robolectric, which this suite does not carry: the two
 * collaborators are an interface and an abstract class, and the only thing
 * asked of them is a map with a write barrier.
 */
class KeepAliveStateTest {

    private lateinit var prefs: SharedPreferences
    private lateinit var editor: SharedPreferences.Editor
    private lateinit var context: Context

    @BeforeEach
    fun setUp() {
        editor = mockk(relaxed = true)
        every { editor.putBoolean(any(), any()) } returns editor
        prefs = mockk(relaxed = true)
        every { prefs.edit() } returns editor
        context = mockk(relaxed = true)
        every { context.getSharedPreferences(any(), any()) } returns prefs
    }

    @AfterEach
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `a wanted server is recorded, and the record is committed`() {
        KeepAliveState.markServerWanted(context)

        verify { editor.putBoolean(KeepAliveState.KEY_SERVER_WANTED, true) }
        verify(exactly = 1) { editor.commit() }
    }

    @Test
    fun `a server the user stopped is unrecorded the same way`() {
        KeepAliveState.clearServerWanted(context)

        verify { editor.putBoolean(KeepAliveState.KEY_SERVER_WANTED, false) }
        verify(exactly = 1) { editor.commit() }
    }

    /**
     * The property both writes above exist for, stated as an assertion so a
     * future edit that reaches for `apply()` fails here rather than on a
     * device nobody is watching.
     */
    @Test
    fun `neither write is deferred`() {
        KeepAliveState.markServerWanted(context)
        KeepAliveState.clearServerWanted(context)

        verify(exactly = 0) { editor.apply() }
    }

    @Test
    fun `an untouched install is owed nothing`() {
        // The default has to be absent rather than true: a fresh install has
        // never run a server, and a watchdog that resurrected one would start
        // a server the user never asked for, on a phone that just booted.
        every { prefs.getBoolean(KeepAliveState.KEY_SERVER_WANTED, false) } returns false

        assertFalse(KeepAliveState.serverWanted(context))
    }

    @Test
    fun `what was committed is what is read back`() {
        every { prefs.getBoolean(KeepAliveState.KEY_SERVER_WANTED, false) } returns true

        assertTrue(KeepAliveState.serverWanted(context))
    }
}
