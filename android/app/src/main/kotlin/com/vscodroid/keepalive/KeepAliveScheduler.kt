package com.vscodroid.keepalive

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock

/**
 * The alarms that bring a wanted server back after something takes the app
 * away.
 *
 * Three ways the app loses the process while the user still wants the
 * server, and an alarm answers each of them:
 *
 *  - **A task swiped from recents.** Answered by [scheduleTaskRemovalRestart],
 *    a one-shot alarm a second out, scheduled from `NodeService.onTaskRemoved`.
 *    Stock Android documents a started service as surviving the task
 *    (`android:stopWithTask` defaults to false, and the manifest now says so
 *    out loud), but the process it runs in is another matter, and the phones
 *    this app is built for are not all stock. The alarm is the honest answer
 *    to both outcomes: if the service survived, the restart it triggers is a
 *    no-op; if it did not, this is what brings it back.
 *  - **A low-memory or OEM kill.** Answered by [arm]'s repeating alarm. A
 *    background process is among the first the low-memory killer takes, and
 *    on the phones that ship their own memory management there is no promise
 *    at all. The interval is a bound on how long the server can be gone, not
 *    a claim that it is never gone.
 *  - **A restart of the device.** Alarms do not survive one, so
 *    `KeepAliveReceiver` re-arms on BOOT_COMPLETED, and starts the server
 *    back up if [KeepAliveState] says one was running when the device powered
 *    off.
 *
 * Why alarms rather than a service restarted directly: a foreground service
 * started from the background is what Android 12+ refuses with
 * `ForegroundServiceStartNotAllowedException`, and every one of the three
 * paths above runs with nothing on screen. An alarm firing is its own
 * exemption from that restriction, and the battery exemption the first-run
 * guide asks for is a second, broader one. The receiver that takes the alarm
 * decides whether to act, and catches the refusal if it comes anyway; the
 * next alarm is the retry.
 *
 * Nothing here is scheduled on its own. `NodeService` arms the repeating
 * alarm where a run begins and disarms it where a run ends for good, so an
 * app the user is not running a server in carries no alarms at all.
 */
internal object KeepAliveScheduler {

    /**
     * How often the watchdog asks whether a wanted server is still there.
     *
     * Fifteen minutes, and the number is a compromise rather than a
     * measurement: short enough that a server killed by a memory reclaim is
     * back before the user notices it gone, long enough that an inexact
     * repeating alarm is not doing work all day. There is no tighter bound
     * available from here: `JobScheduler`'s periodic minimum is the same
     * fifteen minutes, and an exact alarm this often would be a battery
     * complaint of its own.
     */
    const val RESURRECT_INTERVAL_MS = 15 * 60 * 1000L

    /**
     * How long after the task is swiped away the one-shot restart alarm
     * waits.
     *
     * One second, which is long enough for a process death the swipe caused
     * to have happened and short enough that a user watching the shade sees
     * the card come back rather than wonders. If the service survived the
     * swipe, this fires into `ALREADY_SERVING` and costs one log line.
     */
    const val TASK_REMOVAL_RESTART_DELAY_MS = 1_000L

    /** The repeating alarm's broadcast. */
    const val ACTION_RESURRECT = "com.vscodroid.action.RESURRECT_SERVER"

    /** The task-removal alarm's broadcast. */
    const val ACTION_RESURRECT_NOW = "com.vscodroid.action.RESURRECT_SERVER_NOW"

    // Distinct request codes, because a PendingIntent is identified by its
    // request code as well as its intent: the one-shot and the repeating
    // alarm target the same receiver with different actions, and sharing a
    // code would let one cancel the other.
    private const val REQUEST_RESURRECT = 1001
    private const val REQUEST_RESURRECT_NOW = 1002

    fun arm(context: Context) {
        val alarm = context.getSystemService(AlarmManager::class.java) ?: return
        alarm.setInexactRepeating(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + RESURRECT_INTERVAL_MS,
            RESURRECT_INTERVAL_MS,
            broadcast(context, REQUEST_RESURRECT, ACTION_RESURRECT),
        )
    }

    /**
     * Cancels the repeating alarm, and only that one.
     *
     * The one-shot alarm is deliberately left alone: it has already fired by
     * the time anything calls this, and cancelling a fired alarm is a no-op
     * that reads like a second thing to keep in step.
     */
    fun disarm(context: Context) {
        val alarm = context.getSystemService(AlarmManager::class.java) ?: return
        alarm.cancel(broadcast(context, REQUEST_RESURRECT, ACTION_RESURRECT))
    }

    /**
     * Schedules the one-shot restart a swiped task owes the server.
     *
     * `setExactAndAllowWhileIdle` rather than `setExact`: the alarm has to
     * fire in Doze, because a phone whose screen has been off for an hour is
     * exactly the one where the task was swiped and the process reclaimed.
     * It needs no SCHEDULE_EXACT_ALARM permission, which `setExact` does.
     */
    fun scheduleTaskRemovalRestart(context: Context) {
        val alarm = context.getSystemService(AlarmManager::class.java) ?: return
        alarm.setExactAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + TASK_REMOVAL_RESTART_DELAY_MS,
            broadcast(context, REQUEST_RESURRECT_NOW, ACTION_RESURRECT_NOW),
        )
    }

    /**
     * The broadcast both alarms deliver to.
     *
     * `UPDATE_CURRENT` so a re-arm keeps the one alarm rather than leaving a
     * stale copy beside it. Nothing here puts extras in the intent, so there
     * is nothing for an update to lose.
     */
    private fun broadcast(context: Context, request: Int, action: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            request,
            Intent(context, KeepAliveReceiver::class.java).setAction(action),
            // UPDATE_CURRENT so a re-arm keeps the one alarm rather than
            // leaving a stale extras-carrying copy beside it. Nothing here
            // puts extras in the intent, so there is nothing to lose.
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
}
