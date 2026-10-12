package com.vscodroid.keepalive

import android.content.Context
import android.content.SharedPreferences

/**
 * Whether the user is owed a running server, written where a process death
 * can still read it.
 *
 * Every other piece of server state lives in the service, and the service
 * lives in the process: a low-memory kill, a task swiped from recents or a
 * reboot takes all of it, including the knowledge that a server was ever
 * asked for. The foreground service, the wake lock and the crash-restart
 * budget all defend a process that exists; this is the one record that
 * outlives it, and it is what the watchdog in [KeepAliveScheduler] acts on.
 *
 * The flag is written when a run begins and cleared at the two places the
 * user says otherwise: the notification's Stop, and the give-up state the
 * app enters when a server has crashed more times than the budget allows.
 * Both are in `NodeService`, and neither is optional. Leaving the flag set
 * after either would resurrect a server the user was told was not coming
 * back, which is the one outcome nothing in the app explains.
 *
 * It answers a narrower question than "is a server running". A process the
 * system reclaimed has no answer to that question at all, which is exactly
 * when this is read. The question it answers is "did the user ask for a
 * server and never take it back", and only the user can end that.
 */
internal object KeepAliveState {

    /**
     * The same file `MainActivity` keeps its keep-alive guide flag
     * (`guide_done`) in. One file for one subject: both keys record what the
     * user agreed to about the server outliving the app, and the guide is
     * what grants the battery exemption the watchdog needs to be allowed to
     * act at all.
     */
    const val PREF_FILE = "vscodroid_keepalive"
    const val KEY_SERVER_WANTED = "server_wanted"

    fun markServerWanted(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_SERVER_WANTED, true)
            // commit() rather than apply(), for the reason PREF_HEAP_KILLS
            // gives in NodeService.chargeHeapOverride: the event being
            // recorded is the user asking for a server, and the process death
            // that makes the record matter often follows within seconds of
            // it. apply() writes from a background thread, and a kill landing
            // in that window loses the write and with it the resurrection the
            // write exists for. Two small writes per server lifetime on the
            // main thread is the whole cost.
            .commit()
    }

    fun clearServerWanted(context: Context) {
        prefs(context).edit()
            .putBoolean(KEY_SERVER_WANTED, false)
            .commit()
    }

    fun serverWanted(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SERVER_WANTED, false)

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
}
