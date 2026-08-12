package com.vscodroid.util

import android.content.Context
import android.net.Uri
import com.vscodroid.setup.ToolchainManager
import java.io.File
import java.security.MessageDigest

object Environment {

    fun buildProcessEnvironment(context: Context, port: Int): Map<String, String> {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val filesDir = context.filesDir.absolutePath
        val cacheDir = context.cacheDir.absolutePath
        val homeDir = "$filesDir/home"

        // Use bundled bash if available, otherwise fall back to system shell.
        //
        // SHELL names the usr/bin/bash symlink rather than the .so it points at,
        // and that indirection is what makes shell integration possible at all.
        // VS Code never reads our terminal profile: profile settings are keyed
        // `…profiles.linux`, and the remote reports its platform as "android", so
        // the whole block is skipped and the terminal falls back to $SHELL with no
        // arguments. It then decides whether to inject its bash integration by
        // switching on the *basename* of whatever it launched — `libbash.so`
        // matches nothing, `bash` matches. Verified on device: with the .so named
        // here, no terminal ever received --init-file.
        val shell = if (File("$nativeLibDir/libbash.so").exists())
            getTerminalShellPath(context)
        else
            "/system/bin/sh"

        // Use xterm-256color for bundled bash (full PTY via node-pty native).
        // Fallback to dumb terminal for system shell (basic compatibility).
        val term = if (File("$nativeLibDir/libbash.so").exists())
            "xterm-256color"
        else
            "dumb"

        // Merge toolchain env vars (GOROOT, JAVA_HOME, etc.)
        val toolchainEnv = getToolchainEnvironment(context)
        val extraPath = toolchainEnv.remove("__TOOLCHAIN_EXTRA_PATH")
        val basePath = "$nativeLibDir:$filesDir/usr/bin"
        val path = if (extraPath != null)
            "$basePath:$extraPath:/system/bin"
        else
            "$basePath:/system/bin"

        // Preload script that selectively fixes process.platform ("android" → "linux")
        // for npm/node-gyp only. Build tools like Rollup/esbuild see real "android" platform.
        // Loaded in all Node.js processes via NODE_OPTIONS but only activates with opt-in env var.
        val platformFixPath = "$filesDir/server/platform-fix.js"
        val nodeOptions = "--require=$platformFixPath"

        // The Termux tmux searches "$TMUX_TMPDIR:/data/data/com.termux/files/usr/var/run"
        // for its socket. That second path belongs to Termux's sandbox, not ours, so
        // without the variable every session dies with "no suitable socket path".
        val tmpDir = "$cacheDir/tmp"

        val base = mapOf(
            "HOME" to homeDir,
            "TMPDIR" to tmpDir,
            "TMUX_TMPDIR" to tmpDir,
            "PATH" to path,
            "LD_LIBRARY_PATH" to "$nativeLibDir:$filesDir/usr/lib",
            "NODE_PATH" to "$filesDir/server/vscode-reh/node_modules",
            "NODE_OPTIONS" to nodeOptions,
            "SHELL" to shell,
            "TERM" to term,
            "TERMINFO" to "$filesDir/usr/share/terminfo",
            "LANG" to "en_US.UTF-8",
            "PREFIX" to "$filesDir/usr",
            "PYTHONHOME" to "$filesDir/usr",
            "PYTHONDONTWRITEBYTECODE" to "1",
            "GIT_EXEC_PATH" to "$filesDir/usr/lib/git-core",
            "GIT_TEMPLATE_DIR" to "$filesDir/usr/share/git-core/templates",
            "GIT_SSH_COMMAND" to "$nativeLibDir/libssh.so -F $homeDir/.ssh/config",
            "GIT_SSL_CAPATH" to getSystemCaCertsPath(),
            "SSL_CERT_DIR" to getSystemCaCertsPath(),
            "NPM_CONFIG_PREFIX" to "$filesDir/usr",
            "NPM_CONFIG_CACHE" to "$cacheDir/npm-cache",
            "PROJECTS_DIR" to getProjectsDir(context),
            // The Claude Code CLI otherwise looks for a ripgrep under its own
            // vendor/<arch>-<platform>/ — a directory that cannot exist here,
            // since process.platform reports "android" and the builds shipped
            // are for glibc and musl. Unset, it finds nothing and searching
            // fails with no explanation. Falsy sends it to `rg` on PATH, which
            // is the Bionic build already bundled as libripgrep.so.
            "USE_BUILTIN_RIPGREP" to "0",
            "VSCODROID_PORT" to port.toString(),
            "VSCODROID_VERSION" to getVersionName(context),
        )

        return base + toolchainEnv
    }

    private fun getToolchainEnvironment(context: Context): MutableMap<String, String> {
        return try {
            ToolchainManager(context).getAllToolchainEnv().toMutableMap()
        } catch (e: Exception) {
            // Toolchain state file may not exist yet — not an error
            mutableMapOf()
        }
    }

    fun getNodePath(context: Context): String =
        "${context.applicationInfo.nativeLibraryDir}/libnode.so"

    fun getServerScript(context: Context): String =
        "${context.filesDir}/server/server.js"

    fun getProjectsDir(context: Context): String {
        // App-external storage: no permissions needed, visible in file managers
        // Path: /storage/emulated/0/Android/data/<pkg>/files/projects
        val externalDir = context.getExternalFilesDir(null)
        return if (externalDir != null) {
            File(externalDir, "projects").absolutePath
        } else {
            // Fallback to internal storage if external unavailable
            "${context.filesDir}/home/projects"
        }
    }

    fun getHomeDir(context: Context): String =
        "${context.filesDir}/home"

    fun getUserDataDir(context: Context): String =
        "${context.filesDir}/home/.vscodroid"

    fun getExtensionsDir(context: Context): String =
        "${context.filesDir}/home/.vscodroid/extensions"

    fun getLogsDir(context: Context): String =
        "${context.filesDir}/home/.vscodroid/data/logs"

    fun getServerDir(context: Context): String =
        "${context.filesDir}/server"

    fun getBashPath(context: Context): String =
        "${context.applicationInfo.nativeLibraryDir}/libbash.so"

    /**
     * The shell to name in the terminal profile — the maintained symlink, never
     * the `nativeLibraryDir` binary it points at.
     *
     * VS Code decides whether it can inject shell integration by switching on the
     * *basename* of the profile's executable. `libbash.so` matches no case and the
     * injection is skipped in silence; `bash` matches. The indirection pays twice,
     * because `setupToolSymlinks()` re-points this link on every launch, so the
     * profile no longer goes stale when a reinstall moves `nativeLibraryDir`.
     */
    fun getTerminalShellPath(context: Context): String =
        "${context.filesDir}/usr/bin/bash"

    /**
     * The node the Claude Code extension launches its CLI with.
     *
     * Names the symlink rather than nativeLibraryDir/libnode.so, and the
     * difference matters twice. Android hands out a new nativeLibraryDir on every
     * reinstall, so a path recorded in settings.json goes stale — the symlink
     * lives under filesDir, which does not move, and setupToolSymlinks() re-points
     * it at every launch. And SELinux denies execve on app_data_file, so the
     * script could not be made executable itself; execve resolves the symlink and
     * checks the target, which is in nativeLibraryDir and allowed.
     */
    fun getNodeSymlinkPath(context: Context): String =
        "${context.filesDir}/usr/bin/node"

    fun getGitPath(context: Context): String =
        "${context.applicationInfo.nativeLibraryDir}/libgit.so"

    private fun getSystemCaCertsPath(): String =
        // Android 14+ (APEX module), fallback to legacy path
        if (File("/apex/com.android.conscrypt/cacerts").isDirectory)
            "/apex/com.android.conscrypt/cacerts"
        else
            "/system/etc/security/cacerts"

    private fun getVersionName(context: Context): String =
        try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }

    // -- SAF (Storage Access Framework) --

    fun getSafMirrorsDir(context: Context): String =
        "${context.filesDir}/saf-mirrors"

    fun getSafMirrorDir(context: Context, safUri: Uri): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(safUri.toString().toByteArray())
            .take(6) // 6 bytes = 12 hex chars — collision probability ~1 in 281 trillion
            .joinToString("") { "%02x".format(it) }
        return "${getSafMirrorsDir(context)}/$hash"
    }
}
