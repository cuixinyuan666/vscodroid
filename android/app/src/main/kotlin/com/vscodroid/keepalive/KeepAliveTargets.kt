package com.vscodroid.keepalive

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings

/**
 * The system screens a user can open to let the local server survive the
 * screen turning off. Nothing here grants itself anything: each intent is a
 * page the system or the phone maker shows, and the user decides.
 */
internal object KeepAliveTargets {

    fun batteryUnrestricted(context: Context): Boolean {
        val power = context.getSystemService(PowerManager::class.java) ?: return false
        return power.isIgnoringBatteryOptimizations(context.packageName)
    }

    fun batteryExemptionIntent(context: Context): Intent =
        Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}"),
        )

    /**
     * A manufacturer autostart screen, when this phone has one that will open.
     * Stock Android has no such page; the battery exemption is the whole ask.
     */
    fun autostartIntent(context: Context): Intent? {
        val pm = context.packageManager
        for ((pkg, cls) in AUTOSTART) {
            val intent = Intent().setComponent(ComponentName(pkg, cls))
            if (pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null) {
                return intent
            }
        }
        return null
    }

    private val AUTOSTART = listOf(
        "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
        "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
        "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
        "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
        "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
        "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
        "com.samsung.android.lool" to "com.samsung.android.sm.battery.ui.BatteryActivity",
        // Meizu / Flyme: background management + autostart live under the
        // built-in security center on Flyme 9/10. No single documented
        // activity; try the known aliases in order, first resolvable wins.
        "com.meizu.safe" to "com.meizu.safe.powerui.PowerAppPermissionActivity",
        "com.meizu.safe" to "com.meizu.safe.security.AppSecActivity",
        "com.meizu.flyme.service" to "com.meizu.flyme.service.security.AppSecActivity",
    )
}
