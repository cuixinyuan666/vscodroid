package com.vscodroid.setup

import android.content.Context
import android.system.Os
import com.vscodroid.util.Environment
import com.vscodroid.util.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException

class FirstRunSetup(private val context: Context) {
    private val tag = "FirstRunSetup"
    private val prefs = context.getSharedPreferences("vscodroid_setup", Context.MODE_PRIVATE)

    var onProgress: ((message: String, percent: Int) -> Unit)? = null

    enum class SetupResult { SUCCESS, LOW_STORAGE, ERROR }

    fun isFirstRun(): Boolean {
        val installedVersion = prefs.getString(KEY_VERSION, null)
        val currentVersion = getCurrentVersion()
        return installedVersion != currentVersion
    }

    suspend fun runSetup(): SetupResult = withContext(Dispatchers.IO) {
        val previousVersionCode = getPreviousVersionCode()
        val currentVersionCode = getCurrentVersionCode()
        val isUpgrade = previousVersionCode > 0

        if (isUpgrade) {
            Logger.i(tag, "Upgrading from versionCode $previousVersionCode to $currentVersionCode (${getCurrentVersion()})")
        } else {
            Logger.i(tag, "Fresh install, version ${getCurrentVersion()} (versionCode $currentVersionCode)")
        }
        val startTime = System.currentTimeMillis()

        // Pre-flight: check available storage (~500MB needed for extraction)
        val available = context.filesDir.usableSpace
        val required = 500L * 1_048_576L
        if (available < required) {
            Logger.e(tag, "Insufficient storage: ${available / 1_048_576}MB available, ${required / 1_048_576}MB required")
            return@withContext SetupResult.LOW_STORAGE
        }

        try {
            reportProgress("Creating directories...", 2)
            createDirectories()

            if (isUpgrade) {
                runPreExtractionMigrations(previousVersionCode)
            }

            // The reh-web download carries the web client inside this same tree,
            // so this one extraction is both the server and the workbench.
            reportProgress("Extracting server files...", 5)
            extractAssetDir("vscode-reh", "server/vscode-reh")

            reportProgress("Extracting server bootstrap...", 60)
            extractAssetFile("server.js", "server/server.js")
            extractAssetFile("process-monitor.js", "server/process-monitor.js")
            extractAssetFile("platform-fix.js", "server/platform-fix.js")

            reportProgress("Extracting tools...", 62)
            extractAssetDir("usr", "usr")

            reportProgress("Setting up git...", 82)
            setupGitCore()

            reportProgress("Setting up tools...", 85)
            setupToolSymlinks()
            setupRipgrepVscodeSymlink()
            setupSshDefaults()
            createBashrc()
            createBashProfile()
            createTmuxConf()
            createNpmWrappers()  // After createBashrc — appends npm functions to .bashrc
            createStorageSymlinks()
            createWelcomeProject()

            reportProgress("Setting up extensions...", 88)
            extractBundledExtensions()

            reportProgress("Configuring environment...", 97)
            createDefaultSettings()

            reportProgress("Done!", 100)

            if (isUpgrade) {
                runMigrations(previousVersionCode)
            }

            markSetupComplete()

            val elapsed = System.currentTimeMillis() - startTime
            Logger.i(tag, "First-run setup completed in ${elapsed}ms")
            SetupResult.SUCCESS
        } catch (e: Exception) {
            Logger.e(tag, "First-run setup failed", e)
            SetupResult.ERROR
        }
    }

    private fun createDirectories() {
        val dirs = listOf(
            "home",
            "home/.ssh",
            "home/.vscodroid",
            "home/.vscodroid/extensions",
            "home/.vscodroid/data/logs",
            "home/.vscodroid/logs",
            "server",
            "usr/bin",
            "usr/lib",
            "usr/lib/git-core",
            "usr/lib/python3.12",
            "usr/share/terminfo",
        )
        for (dir in dirs) {
            val file = File(context.filesDir, dir)
            if (!file.exists()) {
                file.mkdirs()
            }
        }
        val tmpDir = File(context.cacheDir, "tmp")
        if (!tmpDir.exists()) tmpDir.mkdirs()

        // App-external projects directory (visible in file managers)
        val projectsDir = File(Environment.getProjectsDir(context))
        if (!projectsDir.exists()) projectsDir.mkdirs()
    }

    private fun extractAssetDir(assetPath: String, destPath: String) {
        val destDir = File(context.filesDir, destPath)
        try {
            val assets = context.assets.list(assetPath) ?: return
            if (assets.isEmpty()) {
                extractAssetFile(assetPath, destPath)
                return
            }
            destDir.mkdirs()
            for (asset in assets) {
                extractAssetDir("$assetPath/$asset", "$destPath/$asset")
            }
        } catch (e: IOException) {
            Logger.d(tag, "Treating $assetPath as file (not directory)")
            extractAssetFile(assetPath, destPath)
        }
    }

    private fun extractAssetFile(assetPath: String, destPath: String) {
        val destFile = File(context.filesDir, destPath)
        destFile.parentFile?.mkdirs()
        try {
            context.assets.open(assetPath).use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
            }
        } catch (e: IOException) {
            Logger.d(tag, "Asset not found: $assetPath (will be available after build)")
        }
    }

    private fun setupGitCore() {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val gitCorePath = File(context.filesDir, "usr/lib/git-core")
        val manifestFile = File(gitCorePath, "gitcore-symlinks")

        if (!manifestFile.exists()) {
            Logger.d(tag, "No gitcore-symlinks manifest found, skipping git-core setup")
            return
        }

        val gitBinary = "$nativeLibDir/libgit.so"
        var symlinksCreated = 0

        // Create symlinks for git subcommands that point to the main git binary
        manifestFile.readLines().filter { it.isNotBlank() }.forEach { name ->
            val linkPath = File(gitCorePath, name)
            if (!linkPath.exists()) {
                try {
                    Os.symlink(gitBinary, linkPath.absolutePath)
                    symlinksCreated++
                } catch (e: Exception) {
                    Logger.d(tag, "Failed to create symlink for $name: ${e.message}")
                }
            }
        }

        // Set execute permission on all files in git-core
        gitCorePath.listFiles()?.forEach { file ->
            if (file.isFile && !file.name.startsWith(".")) {
                file.setExecutable(true, true)
            }
        }

        Logger.i(tag, "git-core setup: $symlinksCreated symlinks created")
    }

    /**
     * Creates or updates symlinks in usr/bin/ pointing to native binaries.
     *
     * Android changes the nativeLibraryDir path on every reinstall (random hash),
     * so existing symlinks may point to a stale path. This method validates and
     * recreates them as needed — safe to call on every launch, not just first run.
     */
    fun setupToolSymlinks() {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val binDir = File(context.filesDir, "usr/bin")
        binDir.mkdirs()

        val tools = mapOf(
            "bash" to "libbash.so",
            "git" to "libgit.so",
            "node" to "libnode.so",
            "python3" to "libpython.so",
            "python" to "libpython.so",
            "rg" to "libripgrep.so",
            "tmux" to "libtmux.so",
            "make" to "libmake.so",
            "ssh" to "libssh.so",
            "ssh-keygen" to "libssh-keygen.so",
        )

        var created = 0
        var updated = 0
        for ((name, soName) in tools) {
            var linkUpdated = false
            val link = File(binDir, name)
            val target = "$nativeLibDir/$soName"
            if (!File(target).exists()) continue

            // Check if a symlink already exists (lstat doesn't follow symlinks,
            // unlike File.exists() which returns false for dangling symlinks)
            val linkExists = try { Os.lstat(link.absolutePath); true } catch (e: Exception) { false }

            if (linkExists) {
                try {
                    val currentTarget = Os.readlink(link.absolutePath)
                    if (currentTarget == target) continue
                } catch (_: Exception) { }
                // Stale or broken symlink — remove it
                link.delete()
                updated++
                linkUpdated = true
            }

            try {
                Os.symlink(target, link.absolutePath)
                if (!linkUpdated) created++
            } catch (e: Exception) {
                Logger.d(tag, "Failed to create symlink $name -> $soName: ${e.message}")
            }
        }
        Logger.i(tag, "Tool symlinks: $created created, $updated updated in usr/bin/")
    }

    /**
     * Creates a symlink so VS Code's @vscode/ripgrep finds rg at its expected path.
     * The rg binary lives in nativeLibraryDir as libripgrep.so, but VS Code looks for
     * node_modules/@vscode/ripgrep/bin/rg inside the server directory.
     * Safe to call on every launch (recreates if stale, skips if current).
     */
    fun setupRipgrepVscodeSymlink() {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val rgBinary = File("$nativeLibDir/libripgrep.so")
        if (!rgBinary.exists()) return

        val rgBinDir = File(context.filesDir, "server/vscode-reh/node_modules/@vscode/ripgrep/bin")
        rgBinDir.mkdirs()
        val rgLink = File(rgBinDir, "rg")
        val target = rgBinary.absolutePath

        val linkExists = try { Os.lstat(rgLink.absolutePath); true } catch (e: Exception) { false }
        if (linkExists) {
            try {
                if (Os.readlink(rgLink.absolutePath) == target) return
            } catch (_: Exception) { }
            rgLink.delete()
        }

        try {
            Os.symlink(target, rgLink.absolutePath)
            Logger.i(tag, "ripgrep symlink: ${rgLink.absolutePath} -> $target")
        } catch (e: Exception) {
            Logger.d(tag, "Failed to create ripgrep symlink: ${e.message}")
        }
    }

    /**
     * Creates default SSH configuration for git operations.
     *
     * Sets up ~/.ssh/ directory, default ssh_config (auto-accept first connection,
     * ed25519 key, keepalive), and correct file permissions. Only runs on first setup
     * — does not overwrite existing user SSH config.
     */
    private fun setupSshDefaults() {
        val homeDir = context.filesDir.absolutePath + "/home"
        val sshDir = File(homeDir, ".ssh")
        sshDir.mkdirs()

        // Set directory permissions to 700 (owner only)
        try {
            Os.chmod(sshDir.absolutePath, 448) // 0700 octal = 448 decimal
        } catch (e: Exception) {
            Logger.d(tag, "Failed to chmod .ssh: ${e.message}")
        }

        // Create default ssh_config if it doesn't exist.
        // Uses absolute paths because Termux openssh resolves ~ to its
        // compiled-in prefix (/data/data/com.termux/...), not $HOME.
        val sshConfig = File(sshDir, "config")
        if (!sshConfig.exists()) {
            sshConfig.writeText("""
                Host *
                    StrictHostKeyChecking accept-new
                    IdentityFile $homeDir/.ssh/id_ed25519
                    ServerAliveInterval 60
                    UserKnownHostsFile $homeDir/.ssh/known_hosts
            """.trimIndent() + "\n")
            try {
                Os.chmod(sshConfig.absolutePath, 384) // 0600
            } catch (e: Exception) {
                Logger.d(tag, "Failed to chmod ssh config: ${e.message}")
            }
        }

        Logger.i(tag, "SSH defaults configured")
    }

    /**
     * Ensures npm/npx shell functions exist in .bashrc and creates .npmrc.
     *
     * SELinux denies app_data_file:file execute_no_trans for targetSdk >= 29, so a
     * script with a shebang under filesDir fails with "bad interpreter: Permission
     * denied" no matter how it is chmod'ed. Instead, npm/npx are defined as bash
     * functions that invoke node with the cli entry point.
     *
     * Safe to call on every launch — only appends if functions are missing.
     */
    fun createNpmWrappers() {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val filesDir = context.filesDir.absolutePath
        val npmCliJs = "$filesDir/usr/lib/node_modules/npm/bin/npm-cli.js"

        // Only set up if npm was actually extracted
        if (!File(npmCliJs).exists()) {
            Logger.d(tag, "npm not extracted yet, skipping npm setup")
            return
        }

        // Remove stale script-based wrappers from previous versions
        val binDir = File(context.filesDir, "usr/bin")
        for (name in listOf("npm", "npx")) {
            val script = File(binDir, name)
            if (script.exists() && !isSymlink(script)) {
                script.delete()
                Logger.d(tag, "Removed stale $name script wrapper")
            }
        }

        // Append npm/npx functions to .bashrc if not already present
        val bashrc = File(context.filesDir, "home/.bashrc")
        if (bashrc.exists()) {
            val content = bashrc.readText()
            if (!content.contains("npm()")) {
                bashrc.appendText(npmBashFunctions())
                Logger.i(tag, "Appended npm/npx functions to .bashrc")
            }
        }

        // Update .npmrc on every launch — nativeLibDir changes on APK reinstall
        val npmrc = File(context.filesDir, "home/.npmrc")
        val bashPath = "$nativeLibDir/libbash.so"
        // script-shell: use bundled bash for npm lifecycle scripts (Android has no /bin/sh)
        // os[]: install optional deps for both linux and android so tools like
        // @rollup/rollup-android-arm64 get installed alongside linux fallbacks
        val expectedContent = "script-shell=$bashPath\nos[]=linux\nos[]=android\n"
        if (!npmrc.exists() || npmrc.readText() != expectedContent) {
            npmrc.writeText(expectedContent)
            Logger.d(tag, "Updated .npmrc")
        }
    }

    /**
     * Ensures .bashrc sources toolchain-env.sh for on-demand toolchain env vars.
     * Safe to call on every launch — only appends if the sourcing line is missing.
     */
    fun ensureToolchainEnvSourcing() {
        val bashrc = File(context.filesDir, "home/.bashrc")
        if (bashrc.exists()) {
            val content = bashrc.readText()
            if (!content.contains("toolchain-env.sh")) {
                bashrc.appendText("""

# On-demand toolchain env vars (Go, Ruby, Java, etc.)
[ -f "${'$'}HOME/.vscodroid/toolchain-env.sh" ] && . "${'$'}HOME/.vscodroid/toolchain-env.sh"
""")
                Logger.i(tag, "Appended toolchain-env.sh sourcing to .bashrc")
            }
        }
    }

    /**
     * Brings the .bashrc prompt block up to [PROMPT_VERSION], rewriting whatever
     * older shape is there.
     *
     * The block is fenced by versioned markers so that any future change to it is
     * migratable. The first version had no markers at all — it printed straight
     * out of PROMPT_COMMAND with PS1 left empty, dating from when the terminal was
     * a pipe rather than the PTY node-pty now gives us — so that shape is also
     * recognised, by its function name and its `PS1=''`.
     *
     * Safe to call on every launch: it returns immediately once the current marker
     * is present, and a .bashrc whose prompt the user has rewritten matches no
     * anchor at all, so it is left as they wrote it.
     */
    fun ensurePromptFix() {
        val bashrc = File(context.filesDir, "home/.bashrc")
        if (!bashrc.exists()) return

        val content = bashrc.readText()
        if (content.contains(PROMPT_MARKER_CURRENT)) return

        // Earliest anchor wins, so the old explanatory comment is swallowed too
        // rather than left behind describing a mechanism the file no longer uses.
        val start = listOf(PROMPT_BEGIN, LEGACY_PROMPT_COMMENT, PROMPT_ANCHOR_START)
            .map { content.indexOf(it) }
            .filter { it >= 0 }
            .minOrNull() ?: return

        val fenced = content.indexOf(PROMPT_END, start)
        val end = if (fenced >= 0) {
            content.indexOf('\n', fenced).takeIf { it >= 0 } ?: content.length
        } else {
            val legacy = content.indexOf(PROMPT_ANCHOR_END, start)
            if (legacy < 0) return
            legacy + PROMPT_ANCHOR_END.length
        }

        bashrc.writeText(content.substring(0, start) + PROMPT_BLOCK + content.substring(end))
        Logger.i(tag, "Rewrote the .bashrc prompt block ($PROMPT_VERSION)")
    }

    private fun isSymlink(file: File): Boolean = try {
        Os.lstat(file.absolutePath)
        file.canonicalPath != file.absolutePath
    } catch (e: Exception) { false }

    private fun npmBashFunctions(): String = """

# npm/npx — shell functions (SELinux blocks exec of scripts under filesDir)
# VSCODROID_PLATFORM_FIX=1: override process.platform to "linux" for npm only
# (child processes like Rollup/esbuild see real "android" platform)
# --prefer-offline: use local cache first, saves time on slow mobile connections
npm() { VSCODROID_PLATFORM_FIX=1 node "${'$'}PREFIX/lib/node_modules/npm/bin/npm-cli.js" --prefer-offline "${'$'}@"; }
npx() { VSCODROID_PLATFORM_FIX=1 node "${'$'}PREFIX/lib/node_modules/npm/bin/npx-cli.js" "${'$'}@"; }
"""

    /**
     * Updates nativeLibraryDir paths in settings.json.
     *
     * Android changes nativeLibraryDir on every reinstall (random hash in path).
     * Settings like terminal.integrated.profiles.linux.bash.path and git.path
     * reference this directory, so they must be refreshed on each launch.
     */
    fun updateSettingsNativeLibPaths() {
        val settingsFile = File(context.filesDir, "home/.vscodroid/User/settings.json")
        if (!settingsFile.exists()) return

        val updated = refreshManagedPaths(
            settingsFile.readText(),
            Environment.getTerminalShellPath(context),
            Environment.getGitPath(context),
        ) ?: return

        settingsFile.writeText(updated)
        Logger.i(tag, "Refreshed managed paths in settings.json")
    }

    private fun createWelcomeProject() {
        val projectsDir = File(Environment.getProjectsDir(context))
        val welcomeFile = File(projectsDir, "README.md")
        if (!welcomeFile.exists()) {
            welcomeFile.writeText("""
                # Welcome to VSCodroid

                This is your default projects directory. Create folders here to start coding.

                Your default projects are stored at:
                `Android/data/${context.packageName}/files/projects/`

                **Open any folder on your device**: Use the Command Palette
                (F1) → "VSCodroid: Open Folder from Device" to browse Downloads,
                USB drives, or cloud storage folders.

                **Recent folders**: Use "VSCodroid: Open Recent Folder" to quickly
                reopen previously selected folders.
            """.trimIndent() + "\n")
        }
    }

    private fun createStorageSymlinks() {
        val homeDir = File(context.filesDir, "home")
        val projectsDir = Environment.getProjectsDir(context)

        // ~/projects -> app-external projects dir (convenience symlink)
        val link = File(homeDir, "projects")
        if (!link.exists() && File(projectsDir).exists()) {
            try {
                Os.symlink(projectsDir, link.absolutePath)
            } catch (e: Exception) {
                Logger.d(tag, "Failed to create projects symlink: ${e.message}")
            }
        }
    }

    private fun createBashrc() {
        val projectsDir = Environment.getProjectsDir(context)
        val safMirrorsDir = Environment.getSafMirrorsDir(context)
        val bashrc = File(context.filesDir, "home/.bashrc")
        if (!bashrc.exists()) {
            bashrc.writeText("# VSCodroid bash configuration\n" + PROMPT_BLOCK + "\n\n" + """
                export PROJECTS_DIR='$projectsDir'
                export SAF_MIRRORS_DIR='$safMirrorsDir'
                alias ls='ls --color=auto'
                alias ll='ls -la'

                # On-demand toolchain env vars (Go, Ruby, Java, etc.)
                [ -f "${'$'}HOME/.vscodroid/toolchain-env.sh" ] && . "${'$'}HOME/.vscodroid/toolchain-env.sh"

                # Start in the active folder (SAF or default projects dir)
                if [ -f "${'$'}HOME/.vscodroid_folder" ]; then
                    __folder="${'$'}(cat "${'$'}HOME/.vscodroid_folder" 2>/dev/null)"
                    [ -d "${'$'}__folder" ] && cd "${'$'}__folder" 2>/dev/null || cd "${'$'}PROJECTS_DIR" 2>/dev/null || true
                    unset __folder
                else
                    cd "${'$'}PROJECTS_DIR" 2>/dev/null || true
                fi
            """.trimIndent() + "\n")
        }
    }

    private fun createBashProfile() {
        val bashProfile = File(context.filesDir, "home/.bash_profile")
        if (!bashProfile.exists()) {
            bashProfile.writeText("""
                # Source .bashrc for login shells (e.g. tmux sessions)
                if [ -f "${'$'}HOME/.bashrc" ]; then
                    . "${'$'}HOME/.bashrc"
                fi
            """.trimIndent() + "\n")
        }
    }

    private fun createTmuxConf() {
        val tmuxConf = File(context.filesDir, "home/.tmux.conf")
        if (!tmuxConf.exists()) {
            tmuxConf.writeText("""
                # VSCodroid tmux configuration
                set -g mouse on
                set -g default-terminal "xterm-256color"
                set -g history-limit 10000
                set -g escape-time 10
                set -g status off
            """.trimIndent() + "\n")
        }
    }

    private fun createDefaultSettings() {
        val nativeLibDir = context.applicationInfo.nativeLibraryDir
        val settingsDir = File(context.filesDir, "home/.vscodroid/User")
        settingsDir.mkdirs()
        val settingsFile = File(settingsDir, "settings.json")
        if (!settingsFile.exists()) {
            // The terminal profile is inert today and is written for the day it is
            // not. VS Code keys these settings `…profiles.linux`, the remote
            // reports its platform as "android", so the whole block is skipped and
            // terminals fall back to $SHELL — which is why Environment sets SHELL
            // to the usr/bin/bash symlink rather than the .so. Verified on device:
            // even an explicit --init-file placed in these args never reached the
            // spawned shell. Fixing platform detection at source makes the profile
            // live again, so it is kept correct: the path names the symlink so the
            // basename is `bash`, and the args stay empty because VS Code only
            // injects shell integration for empty or login args.
            settingsFile.writeText("""
                {
                    "workbench.startupEditor": "none",
                    "workbench.colorTheme": "Default Dark Modern",
                    "editor.fontSize": 14,
                    "editor.wordWrap": "on",
                    "editor.minimap.enabled": false,
                    "diffEditor.wordWrap": "on",
                    "terminal.integrated.fontSize": 13,
                    "terminal.integrated.defaultProfile.linux": "bash",
                    "terminal.integrated.profiles.linux": {
                        "bash": {
                            "path": "${Environment.getTerminalShellPath(context)}",
                            "args": [],
                            "icon": "terminal-bash"
                        }
                    },
                    "git.path": "$nativeLibDir/libgit.so",
                    "terminal.integrated.shellIntegration.enabled": true,
                    "telemetry.telemetryLevel": "off",
                    "telemetry.enableTelemetry": false,
                    "update.mode": "none",
                    "update.showReleaseNotes": false,
                    "security.workspace.trust.enabled": false,
                    "python.languageServer": "Jedi",
                    "python.defaultInterpreterPath": "${context.filesDir.absolutePath}/usr/bin/python3",
                    "gitlens.showWelcomeOnInstall": false,
                    "gitlens.showWhatsNewAfterUpgrades": false,
                    "gitlens.codeLens.enabled": false,
                    "gitlens.currentLine.enabled": true,
                    "gitlens.hovers.enabled": false,
                    "gitlens.statusBar.enabled": false,
                    "launch": {
                        "version": "0.2.0",
                        "configurations": [
                            {
                                "name": "Attach to Node.js",
                                "type": "node",
                                "request": "attach",
                                "port": 9229,
                                "restart": true,
                                "skipFiles": ["<node_internals>/**"]
                            },
                            {
                                "name": "NestJS: Debug",
                                "type": "node",
                                "request": "launch",
                                "runtimeArgs": ["--inspect", "-r", "ts-node/register", "-r", "tsconfig-paths/register"],
                                "args": ["${'$'}{workspaceFolder}/src/main.ts"],
                                "skipFiles": ["<node_internals>/**"],
                                "console": "integratedTerminal"
                            },
                            {
                                "name": "Node.js: Run Current File",
                                "type": "node",
                                "request": "launch",
                                "program": "${'$'}{file}",
                                "skipFiles": ["<node_internals>/**"],
                                "console": "integratedTerminal"
                            }
                        ]
                    }
                }
            """.trimIndent())
        }
    }

    private fun extractBundledExtensions() {
        val extensionsDir = File(context.filesDir, "home/.vscodroid/extensions")
        extensionsDir.mkdirs()

        val bundled = try {
            context.assets.list("extensions") ?: emptyArray()
        } catch (e: IOException) {
            Logger.d(tag, "No bundled extensions in assets")
            emptyArray()
        }

        if (bundled.isEmpty()) {
            Logger.d(tag, "No bundled extensions found")
            return
        }

        var extracted = 0
        for (name in bundled) {
            val dest = File(extensionsDir, name)
            if (!dest.exists()) {
                extractAssetDir("extensions/$name", "home/.vscodroid/extensions/$name")
                extracted++
            }
        }

        // Generate extensions.json only if it doesn't exist (first run).
        // VS Code Server manages this file for marketplace-installed extensions,
        // so we only write it once for bundled extensions.
        val manifestFile = File(extensionsDir, "extensions.json")
        if (!manifestFile.exists()) {
            generateExtensionsManifest(extensionsDir, bundled)
        }

        Logger.i(tag, "Bundled extensions: $extracted extracted, ${bundled.size} total")
    }

    private fun generateExtensionsManifest(extensionsDir: File, bundledDirs: Array<String>) {
        val entries = JSONArray()

        for (dirName in bundledDirs) {
            val extDir = File(extensionsDir, dirName)
            val pkgFile = File(extDir, "package.json")
            if (!pkgFile.exists()) {
                Logger.d(tag, "No package.json in $dirName, skipping manifest entry")
                continue
            }

            try {
                val pkg = JSONObject(pkgFile.readText())
                val publisher = pkg.optString("publisher", "")
                val name = pkg.optString("name", "")
                val version = pkg.optString("version", "")

                if (publisher.isEmpty() || name.isEmpty()) continue

                val id = "${publisher.lowercase()}.${name.lowercase()}"

                val entry = JSONObject().apply {
                    put("identifier", JSONObject().put("id", id))
                    put("version", version)
                    put("location", JSONObject().apply {
                        put("\$mid", 1)
                        put("path", extDir.absolutePath)
                        put("scheme", "file")
                    })
                    put("relativeLocation", dirName)
                    put("metadata", JSONObject().apply {
                        put("installedTimestamp", System.currentTimeMillis())
                        put("source", "bundled")
                    })
                }
                entries.put(entry)
            } catch (e: Exception) {
                Logger.d(tag, "Failed to parse $dirName/package.json: ${e.message}")
            }
        }

        val manifestFile = File(extensionsDir, "extensions.json")
        manifestFile.writeText(entries.toString(2))
        Logger.i(tag, "Generated extensions.json with ${entries.length()} entries")
    }

    /**
     * Migrations that have to run *before* the assets are unpacked.
     *
     * Kept separate from [runMigrations] because the ordering is not a detail:
     * extraction merges into whatever is already on disk and never deletes, so
     * anything that removes a stale tree has to happen first. Run afterwards it
     * would delete what was just unpacked, and the app would come up with no
     * server at all.
     */
    private fun runPreExtractionMigrations(fromVersionCode: Int) {
        if (fromVersionCode < PIVOT_VERSION_CODE) {
            // The server tree changed origin, not just version: what was there is a
            // pre-built VS Code Server, and what replaces it is Code - OSS built
            // from source. Their file sets differ — vsda and the bundled node are
            // gone, several paths moved — and extractAssetDir only ever writes over
            // what it recognises. Merging the two leaves orphans from the old tree
            // that nothing overwrites and nothing loads, with no visible symptom
            // beyond behaviour nobody can account for.
            val serverTree = File(context.filesDir, "server/vscode-reh")
            if (serverTree.exists()) {
                val freed = serverTree.walkBottomUp().filter { it.isFile }.sumOf { it.length() }
                if (serverTree.deleteRecursively()) {
                    Logger.i(tag, "Removed the previous server tree (${freed / 1_048_576} MB)")
                } else {
                    // Not fatal on its own: extraction still writes the new tree over
                    // it. Say so loudly, because what survives is the orphan case
                    // above rather than a clean failure.
                    Logger.e(tag, "Could not remove the previous server tree; " +
                        "the new one will be merged into it")
                }
            }
        }
    }

    private fun runMigrations(fromVersionCode: Int) {
        Logger.i(tag, "Running migrations from versionCode $fromVersionCode")

        // Post-extraction migrations go here; anything that deletes belongs in
        // runPreExtractionMigrations instead.
        //
        // Note that files owned by the user are not migrated from this method at
        // all. settings.json and .bashrc are both written only when absent, so a
        // change to their defaults reaches nobody who already has them — the
        // anchored rewrites in updateSettingsNativeLibPaths() and
        // ensurePromptFix() handle that, and they run on every launch rather than
        // only on a version change.

        Logger.i(tag, "Migrations complete")
    }

    fun getPreviousVersionCode(): Int {
        return prefs.getInt(KEY_VERSION_CODE, 0)
    }

    private fun getCurrentVersionCode(): Int {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).let {
                if (android.os.Build.VERSION.SDK_INT >= 28) it.longVersionCode.toInt()
                else @Suppress("DEPRECATION") it.versionCode
            }
        } catch (e: Exception) {
            0
        }
    }

    private fun markSetupComplete() {
        prefs.edit()
            .putString(KEY_VERSION, getCurrentVersion())
            .putInt(KEY_VERSION_CODE, getCurrentVersionCode())
            .apply()
    }

    private fun getCurrentVersion(): String {
        return try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "0"
        } catch (e: Exception) {
            "0"
        }
    }

    private fun reportProgress(message: String, percent: Int) {
        Logger.d(tag, "Progress: $percent% - $message")
        onProgress?.invoke(message, percent)
    }

    companion object {
        private const val KEY_VERSION = "setup_version"
        private const val KEY_VERSION_CODE = "setup_version_code"

        /**
         * The release that replaces the pre-built VS Code Server with Code - OSS
         * built from source. Upgrades from anything earlier need the old server
         * tree removed rather than merged into.
         *
         * Must match versionCode in app/build.gradle.kts for the release that
         * ships the new tree; a mismatch means the migration either never runs or
         * runs for users who do not need it.
         */
        private const val PIVOT_VERSION_CODE = 11
    }
}

/**
 * The prompt block written into `.bashrc`, shared by the first-run write and by
 * [FirstRunSetup.ensurePromptFix], which replaces the legacy empty-PS1 prompt.
 */
private const val PROMPT_VERSION = "v2"
private const val PROMPT_BEGIN = "# >>> vscodroid prompt"
private const val PROMPT_END = "# <<< vscodroid prompt"
private const val PROMPT_MARKER_CURRENT = "$PROMPT_BEGIN $PROMPT_VERSION >>>"

private val PROMPT_BLOCK = """
    $PROMPT_MARKER_CURRENT
    # PROMPT_COMMAND computes the directory, PS1 renders it. The \[ \] markers tell
    # readline which bytes take no width; without them Ctrl+L and any wrapped line
    # redraw over the prompt. An earlier build printed the prompt straight out of
    # PROMPT_COMMAND with an empty PS1, dating from when the terminal was a pipe
    # rather than a PTY — readline could not measure that at all, and VS Code's
    # shell integration ended up wrapping an empty string.
    __vscodroid_prompt() {
        local dir="${'$'}PWD"
        # The tilde must be escaped. bash expands tildes in a substitution's
        # replacement text, so a bare one turns back into the home path and the
        # whole substitution collapses into a no-op. bash 3.2 does not do this,
        # so a macOS shell cannot reproduce it — only a device can.
        dir="${'$'}{dir/#${'$'}HOME/\~}"
        [[ "${'$'}dir" == /* ]] && dir="${'$'}{dir/#${'$'}PROJECTS_DIR/projects}"
        # Abbreviate SAF mirror paths: /data/.../saf-mirrors/<hash>/... → [saf]/...
        # At the mirror root there is nothing after the hash, so stripping has to be
        # conditional — stripping unconditionally leaves the hash itself standing,
        # which is the one thing this abbreviation exists to hide.
        if [[ "${'$'}dir" == *saf-mirrors/* ]]; then
            dir="${'$'}{dir#*saf-mirrors/}"
            case "${'$'}dir" in
                */*) dir="[saf]/${'$'}{dir#*/}" ;;
                *)   dir="[saf]" ;;
            esac
        fi
        __vscodroid_dir="${'$'}dir"
    }
    PROMPT_COMMAND=__vscodroid_prompt
    PS1='\[\033[32m\]${'$'}{__vscodroid_dir}\[\033[0m\] \${'$'} '
    $PROMPT_END $PROMPT_VERSION <<<
""".trimIndent()

/**
 * Anchors for a prompt block written before the versioned markers existed — the
 * shape shipped in v1.0.0, which printed from PROMPT_COMMAND with an empty PS1.
 */
private const val PROMPT_ANCHOR_START = "__vscodroid_prompt() {"
private const val PROMPT_ANCHOR_END = "PS1=''"
private const val LEGACY_PROMPT_COMMENT = "# Prompt via PROMPT_COMMAND"

/**
 * The bundled bash inside the terminal profile, and the bundled git. Both are
 * anchored on their key and match only a nativeLibraryDir value, so a path the
 * user chose themselves is left alone.
 *
 * The character class excludes braces deliberately: an earlier release used
 * `/data/app/[^"]+/lib/[^"]+`, whose tail ran straight past the directory and
 * swallowed the binary filename, leaving the terminal profile pointing at a
 * directory (issue #3). Every quantifier here is fenced by the delimiter it
 * must not cross.
 */
private val LEGACY_BASH_PROFILE_PATH = Regex(
    """("terminal\.integrated\.profiles\.linux"\s*:\s*\{\s*"bash"\s*:\s*\{[^{}]*?"path"\s*:\s*)"/data/app/[^"]*["]"""
)
private val GIT_PATH = Regex("""("git\.path"\s*:\s*)"/data/app/[^"]*["]""")

/**
 * The two settings that shipped alongside the old profile path and blocked shell
 * integration with it. Matched only in the exact shape this app wrote, so a
 * profile the user has since edited is left as they wrote it.
 */
private val LEGACY_PROFILE_ARGS = Regex(
    """("terminal\.integrated\.profiles\.linux"\s*:\s*\{\s*"bash"\s*:\s*\{[^{}]*?"args"\s*:\s*)\["-i"\]"""
)
private val SHELL_INTEGRATION_OFF = Regex(
    """("terminal\.integrated\.shellIntegration\.enabled"\s*:\s*)false"""
)

/**
 * Reconciles the settings.json values this app manages, returning the updated
 * document or `null` when nothing needed changing.
 *
 * Two jobs. `git.path` still embeds `nativeLibraryDir`, which a reinstall moves,
 * so it is re-pointed whenever it has gone stale. The terminal profile is instead
 * migrated *off* `nativeLibraryDir` and onto the `usr/bin/bash` symlink, which
 * `setupToolSymlinks()` already repairs on every launch — after that move the
 * pattern no longer matches and the profile never goes stale again.
 *
 * The move carries the other two halves of the shell-integration fix with it,
 * because all three were written by the same release. Bundling them keeps the
 * migration one-shot: once the path is off `/data/app/`, nothing here fires
 * again, so a user who later turns shell integration back off keeps it off.
 *
 * Substitutes values in place and leaves every other byte untouched.
 * settings.json is JSONC: comments and trailing commas are legal there, so
 * parsing the document to re-serialise it would strip the user's comments,
 * escape every slash, and turn `["-i",]` into `["-i", null]`.
 *
 * A pattern that does not match changes nothing, so a file the user has
 * restructured is left as they wrote it rather than mangled.
 */
internal fun refreshManagedPaths(content: String, shellPath: String, gitPath: String): String? {
    var updated = GIT_PATH.replace(content) { "${it.groupValues[1]}\"$gitPath\"" }

    val movedProfile =
        LEGACY_BASH_PROFILE_PATH.replace(updated) { "${it.groupValues[1]}\"$shellPath\"" }
    if (movedProfile != updated) {
        updated = LEGACY_PROFILE_ARGS.replace(movedProfile) { "${it.groupValues[1]}[]" }
        updated = SHELL_INTEGRATION_OFF.replace(updated) { "${it.groupValues[1]}true" }
    }

    return updated.takeIf { it != content }
}
