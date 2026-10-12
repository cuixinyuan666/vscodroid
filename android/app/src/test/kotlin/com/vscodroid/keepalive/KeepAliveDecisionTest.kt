package com.vscodroid.keepalive

import android.content.Intent
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * What the watchdog acts on, decided without a Context.
 *
 * The receiver reads a persisted flag and a broadcast action, and everything
 * else it does is framework calls a plain JVM cannot make. Extracting the
 * decision is what makes the part that matters reachable from here: both
 * halves of [shouldStartServer] are a boolean over two values, and a defect
 * in either is invisible on a device until the server fails to come back at
 * the one moment the user needed it to.
 *
 * The actions are named as strings rather than through the receiver, which
 * cannot be instantiated here either. That is deliberate and is the same
 * trade `startCommand` makes in `NodeService`: the decision is pure, and the
 * wiring is read as source.
 */
class KeepAliveDecisionTest {

    /** Every broadcast the receiver is willing to act on, in one place. */
    private val acted = listOf(
        Intent.ACTION_BOOT_COMPLETED,
        KeepAliveScheduler.ACTION_RESURRECT,
        KeepAliveScheduler.ACTION_RESURRECT_NOW,
    )

    @Test
    fun `a server the user asked for comes back for every reason it was taken away`() {
        for (action in acted) {
            assertTrue(
                shouldStartServer(action, serverWanted = true),
                "$action did not resurrect a wanted server",
            )
        }
    }

    @Test
    fun `a server nobody asked for is never brought back`() {
        for (action in acted) {
            assertFalse(
                shouldStartServer(action, serverWanted = false),
                "$action resurrected a server the user had stopped",
            )
        }
    }

    /**
     * The half that keeps a foreign broadcast from being a reason a server
     * appears.
     *
     * The manifest receiver is exported, because a system broadcast cannot
     * reach a receiver that is not. Exported means anything on the device can
     * address it, and the only thing standing between a broadcast from
     * another app and a server starting is this list being closed. A null
     * action is in here because [BroadcastReceiver.onReceive] is documented
     * to be able to deliver one, and an alarm whose intent was rewritten by
     * the system is not a thing to reason about from here.
     */
    @Test
    fun `a broadcast the app did not ask for starts nothing, wanted or not`() {
        val foreign = listOf(
            null,
            "android.intent.action.MY_PACKAGE_REPLACED",
            "android.intent.action.AIRPLANE_MODE",
            "com.vscodroid.action.STOP_SERVER",
            "",
        )
        for (action in foreign) {
            assertFalse(
                shouldStartServer(action, serverWanted = true),
                "a foreign broadcast ($action) was treated as a reason to start a server",
            )
        }
    }

    /**
     * Only a restart of the device re-arms the alarms.
     *
     * Alarms survive everything except a restart, so there is exactly one
     * moment the app has to be told about. Arming on the resurrection alarms
     * themselves would replace a live alarm with an identical one and read
     * like a second thing to keep in step; arming on a package replacement
     * would be answering a broadcast the manifest does not even ask for.
     */
    @Test
    fun `boot is the only moment the alarms are armed again`() {
        assertTrue(shouldRearmAfterBoot(Intent.ACTION_BOOT_COMPLETED))
        for (action in acted + listOf(null, "android.intent.action.MY_PACKAGE_REPLACED")) {
            if (action == Intent.ACTION_BOOT_COMPLETED) continue
            assertFalse(
                shouldRearmAfterBoot(action),
                "$action re-armed the watchdog, which only a restart of the device requires",
            )
        }
    }

    /**
     * The two alarm actions are distinct and namespaced.
     *
     * Not a control for the cases above; nothing here can force a future
     * action to be added to [shouldStartServer], and a fourth action added to
     * the receiver without it would fail closed rather than open. What this
     * pins is the pair the scheduler depends on: the repeating alarm and the
     * one-shot share a receiver and differ only by action, so a collision
     * would let one cancel the other, and a rename under a test pinned to the
     * old string is a watchdog that quietly stopped resurrecting.
     */
    @Test
    fun `the two alarm actions are distinct and namespaced`() {
        assertTrue(KeepAliveScheduler.ACTION_RESURRECT.startsWith("com.vscodroid.action."))
        assertTrue(KeepAliveScheduler.ACTION_RESURRECT_NOW.startsWith("com.vscodroid.action."))
        assertTrue(KeepAliveScheduler.ACTION_RESURRECT != KeepAliveScheduler.ACTION_RESURRECT_NOW)
    }
}
