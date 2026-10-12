package com.vscodroid.keepalive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import com.vscodroid.service.NodeService
import com.vscodroid.util.Logger

/**
 * Takes the alarms [KeepAliveScheduler] sets, and the one system broadcast
 * the app needs, and starts the server back up when the user is owed one.
 *
 * The decision is deliberately not the receiver's. [shouldStartServer] is a
 * pure function over the broadcast's action and the persisted flag, so what
 * the receiver does is reachable from a plain JVM test; everything around it
 * here is Android framework calls that are not. The receiver itself holds no
 * state, because the only two things worth holding are the alarm (system
 * owned) and the flag (disk owned), and both outlive it.
 *
 * A plain start, with no action of its own: `NodeService.onStartCommand`
 * already answers a null action with `StartCommand.SERVE` when nothing is
 * serving and with `ALREADY_SERVING` when something is, which is the whole
 * of the two cases a resurrection can be in. Giving this its own action
 * would add a third branch to a decision that is already total, and the
 * branch would have to answer the promotion question the existing arms
 * answer for it.
 */
internal class KeepAliveReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action

        // Boot is the one moment the app is told the alarms are gone. Without
        // this the watchdog survives a reboot in exactly one sense: as an
        // alarm that will never fire again.
        if (shouldRearmAfterBoot(action)) {
            KeepAliveScheduler.arm(context)
        }

        if (!shouldStartServer(action, KeepAliveState.serverWanted(context))) {
            Logger.i(TAG, "No server is owed one; $action changes nothing")
            return
        }

        Logger.i(TAG, "Bringing the server back after $action")
        try {
            ContextCompat.startForegroundService(
                context,
                Intent(context, NodeService::class.java),
            )
        } catch (e: Exception) {
            // The refusal this exists for is
            // ForegroundServiceStartNotAllowedException on Android 12+, and
            // the exemption the guide asks for is what prevents it. Caught
            // rather than allowed to take the process down: a receiver that
            // dies here is a watchdog that cannot try again, and the next
            // alarm is the retry. Logged at error with the throwable, so a
            // refusal nobody predicted still names itself in the report.
            Logger.e(TAG, "The resurrection start was refused; the next alarm retries", e)
        }
    }

    private companion object {
        const val TAG = "KeepAliveReceiver"
    }
}

/**
 * Whether [action] is a moment the alarms have to be armed again.
 *
 * Only a restart of the device. Every other broadcast the app acts on either
 * arrives while the process is alive, where the alarms are too, or is a
 * broadcast of its own, where arming again would replace a live alarm with
 * an identical one.
 */
internal fun shouldRearmAfterBoot(action: String?): Boolean =
    action == Intent.ACTION_BOOT_COMPLETED

/**
 * Whether [action] is a reason to start a server, and one is owed.
 *
 * Both halves are required, and the order is the meaning. A broadcast the
 * app did not ask for (anything but BOOT_COMPLETED and its two alarms)
 * starts nothing whatever the flag says, so a foreign broadcast cannot be
 * the reason a server appears; and a wanted server is not resurrected for a
 * broadcast that is not one of the three, so a cleared flag stays cleared.
 *
 * [serverWanted] is passed in rather than read here because reading it needs
 * a Context and this does not. The one place that difference shows is the
 * test, which is the point of the seam.
 */
internal fun shouldStartServer(action: String?, serverWanted: Boolean): Boolean =
    serverWanted && (
        action == Intent.ACTION_BOOT_COMPLETED ||
            action == KeepAliveScheduler.ACTION_RESURRECT ||
            action == KeepAliveScheduler.ACTION_RESURRECT_NOW
        )
