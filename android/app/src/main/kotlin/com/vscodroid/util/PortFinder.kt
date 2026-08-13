package com.vscodroid.util

import android.content.Context
import java.net.ServerSocket

object PortFinder {
    private const val TAG = "PortFinder"

    /**
     * Base of the scan range, and the fallback when nothing can be bound.
     *
     * Deliberately below the kernel's ephemeral range (`net.ipv4.ip_local_port_range`,
     * typically 32768-60999): a port handed out by `ServerSocket(0)` comes from that
     * range, where an unrelated outbound connection can be holding it at the moment
     * the next launch checks. Scanning from a fixed base keeps the remembered port
     * free far more often, which is the whole point of remembering it.
     */
    private const val DEFAULT_PORT = 13337
    private const val SCAN_RANGE = 64

    private const val PREFS_NAME = "vscodroid"
    private const val KEY_PORT = "server_port"

    /**
     * The port this install serves the workbench on, stable across cold starts.
     *
     * The port is part of the WebView's origin, and the browser keys IndexedDB by
     * origin. Secret storage and every extension's `globalState` live there, so a
     * freshly allocated port on each launch silently emptied all of it — sessions
     * signed out, extension state reset, with nothing in any log to connect it to
     * the port. The chosen port is therefore remembered and reused whenever it is
     * still free.
     *
     * Moving to a different port is still correct when the old one is taken; it
     * costs the workbench storage held under the old origin, so it is logged.
     */
    fun getOrAllocatePort(context: Context): Int {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val remembered = prefs.getInt(KEY_PORT, 0)
        if (remembered != 0 && isPortAvailable(remembered)) {
            return remembered
        }

        val port = findAvailablePort()
        if (remembered != 0) {
            Logger.w(
                TAG,
                "Port $remembered is taken, moving to $port. " +
                    "Workbench storage keyed to the old origin is lost.",
            )
        }
        prefs.edit().putInt(KEY_PORT, port).apply()
        return port
    }

    /**
     * The first free port at or above [DEFAULT_PORT], falling back to an
     * OS-assigned one when the whole scan range is occupied.
     */
    fun findAvailablePort(): Int {
        for (port in DEFAULT_PORT until DEFAULT_PORT + SCAN_RANGE) {
            if (isPortAvailable(port)) return port
        }
        return try {
            ServerSocket(0).use { socket ->
                socket.localPort
            }
        } catch (e: Exception) {
            Logger.w(TAG, "Failed to find available port, using default $DEFAULT_PORT", e)
            DEFAULT_PORT
        }
    }

    fun isPortAvailable(port: Int): Boolean {
        return try {
            ServerSocket(port).use { true }
        } catch (e: Exception) {
            false
        }
    }
}
