# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **The VS Code server is now built from the MIT-licensed Code - OSS source** instead of downloading Microsoft's proprietary pre-built server, which could not legally be modified and redistributed inside an APK. The build applies this repository's patches and branding to readable source, is verified for tree shape, architecture and branding before it ships, and is published once per VS Code version
- VS Code upgraded 1.96.4 → 1.133.0
- Node.js runtime upgraded to 24.18.0, now taken from Termux's `nodejs-lts` package — the previous hand-cross-compiled 20.18.1 segfaulted inside several CLI tools

### Added
- **GitHub Copilot Chat now works on device**: the bundled extension's platform packages are aliased under the name Android resolves, its SDK entry ships again, and `@vscode/sqlite3` is rebuilt for Bionic so model selection completes end to end
- **Claude Code extension support**: the marketplace serves its musl build, the CLI starts through the bundled musl loader, and a loopback DNS proxy gives musl binaries working name resolution
- A glibc compatibility shim: prebuilt glibc-only native addons (spdlog, sqlite3 and friends) now load against Bionic through versioned forwarder stubs instead of dying at `dlopen`
- On-demand toolchain downloads, the server tarball, npm, extensions and every bundled tool are now verified against the strongest digest their source publishes, and a missing or wrong digest fails the build instead of shipping unverified bytes

### Security
- The loopback DNS proxy that gives musl binaries working name resolution now requires a per-boot token. Binding to `127.0.0.1` is not access control on Android — loopback is not isolated per app — so any installed app could previously have used it as an open forwarder for arbitrary outbound connections attributed to VSCodroid

### Fixed
- Chat panels were unusable: the extra key row covered the bottom of the page — exactly where VS Code anchors the chat toolbar — so the model picker and Send button could be seen but never tapped
- Claude Code sign-in died with "Socket is closed": Node abandoned each connection attempt after 250 ms, which the API's handshake regularly exceeded from a phone
- The glibc shim's ctype table misclassified five of twelve character classes, and its `environ`/`stdout`/`stderr` exports loaded as NULL
- Two app instances could run first-run setup concurrently; setup is now single-flight
- Bundled extensions updated by an app upgrade are visible again after the manifest is reconciled, and uninstalling one now sticks across upgrades
- The web walkthrough greets users with VSCodroid branding again, and the hamburger menu returned to touch-friendly sizing — both regressions from the build pivot
- Native terminal and file-watcher addons are built from the same versions as the JavaScript they ship beside, and the build now fails on any mismatch
- Terminal profile picker was empty, leaving no way to switch terminals ([#3](https://github.com/rmyndharis/VSCodroid/issues/3))
- App froze and had to be force-restarted after the server process was killed — automatic recovery never actually ran
- A server restart now returns to the folder you had open instead of the default projects directory
- A WebView rebuilt after a renderer crash no longer comes back without its Android bridge
- Launching no longer crashes outright if refreshing tool paths fails
- Comments and formatting in `settings.json` now survive the refresh of bundled tool paths
- Build and release workflows no longer fail when the runner's package index is out of date
- Cold start no longer crashes while the WebView still shows its placeholder URL — thanks [@4in4in](https://github.com/4in4in) for the fix ([#6](https://github.com/rmyndharis/VSCodroid/pull/6))

## [1.0.0] - 2026-04-21

### 🎉 First Production Release on Google Play Store!

VSCodroid is now publicly available on Google Play. This release represents the cumulative work across milestones M0–M6, bringing a full VS Code IDE experience to Android.

### Added
- CI/CD pipeline: test job in CI, tag-triggered release workflow, GitHub Pages deployment
- Privacy policy hosted on GitHub Pages
- "VSCodroid: About" command in command palette with version info and legal links
- Third-party attribution file (NOTICE.md)
- User guide documentation
- Full changelog with milestone history

### Fixed
- Edge-to-edge display: upgrade AGP 8.9.1 + Activity 1.12.4 + Core 1.16.0 for proper edge-to-edge support
- Material library updated to 1.14.0-alpha09 to resolve edge-to-edge warnings
- Remove deprecated edge-to-edge theme attributes and fitsSystemWindows from layouts

### Changed
- Google Play production access granted — app now publicly available

## [0.1.0-m0] - 2026-02-10

This release represents the cumulative work across milestones M0 through M5, bringing VSCodroid from initial project structure to a fully functional IDE on Android.

### M5: Quick Wins & Developer Experience
- SSH key management: generate ed25519 keys and copy public key from command palette
- "Open in Browser" command for previewing localhost dev servers (Vite, NestJS, etc.)
- Selective `platform-fix.js` preload for npm/node-gyp compatibility (no longer breaks Rollup/esbuild)
- Enhanced process monitor with tiered warnings, kill idle servers command, and storage display
- Bundled debug launch configurations (Attach to Node.js, NestJS Debug, Run Current File)
- `diffEditor.wordWrap` enabled by default
- `npm --prefer-offline` for faster installs

### M4: Polish & Stability
- On-demand toolchains via Play Asset Delivery (Go, Ruby, Java)
- Language Picker UI for first-run toolchain selection
- Toolchain settings screen for install/remove management
- npm 10.8.2 bundled with bash shell functions (noexec workaround)
- Python 3.12.12 bundled from Termux with full stdlib and pip
- Welcome walkthrough extension
- OAuth flow for GitHub authentication via Chrome Custom Tabs
- Storage management: breakdown display, cache clearing
- Crash reporter with bug report generation
- AAPT `ignoreAssetsPattern` fix for underscore-prefixed directories

### M3: SAF & Extensions
- SAF (Storage Access Framework) integration for opening device folders
- SAF two-way sync with file watcher for external storage
- Bundled extensions: One Dark Pro, ESLint, Prettier, Tailwind CSS, GitLens, Python
- Extension version pinning for VS Code 1.96.4 compatibility
- Process monitor extension with status bar indicator and phantom process tree

### M2: Terminal & Mobile UX
- Native node-pty (cross-compiled for ARM64 Android) replacing pipeTerminal.js shim
- Real PTY terminals via `/dev/pts/*` — vim, tmux, readline, colors, job control all work
- Extra Key Row with Ctrl, Alt, Tab, Esc, arrows, brackets, parens, semicolons
- Touch target enlargement CSS for phone-sized screens
- Safe area padding for round-corner devices and display cutouts
- WebView crash recovery with folder context restoration
- Back button navigation integration
- ptyHost as worker_thread (saves phantom process slot)
- Stale symlink detection and recreation on APK reinstall

### M1: Extension Host & Process Management
- Extension Host converted from child_process.fork() to worker_thread
- Phantom process monitor scanning by UID across all processes
- Memory pressure signal path: Kotlin onTrimMemory to process-monitor.js
- Idle language server cleanup (5-minute timeout)
- BroadcastChannel relay for browser extension access to AndroidBridge

### M0: Foundation
- VS Code 1.96.4 Web Client + Server running locally on Android
- Pre-built VS Code Server from Microsoft CDN with Android-specific patches
- Node.js 20.18.1 cross-compiled for ARM64 Android (48 MB libnode.so)
- vsda signing bypass (regex-replace signService.validate with Promise.resolve)
- Native module shims for spdlog and native-watchdog
- CDN URL interception in WebViewClient (rewrite vscode-cdn.net to localhost)
- Webview service worker disabled (Android WebView lifecycle incompatibility)
- Browser extension stubs for 17 built-in extensions
- Workspace Trust bypass for local remote connections
- process.platform "android" → "linux" patching (5 pattern types in minified code)
- product.json branding (VSCodroid, Open VSX marketplace)
- Foreground Service with specialUse for server persistence
- Bundled tools: Bash 5.3.9, Git 2.53.0, tmux 3.6a, Make 4.4.1, OpenSSH, ripgrep
- Open VSX extension marketplace integration
- SSL certificate configuration for HTTPS in Node.js
- Git path configuration for VS Code Git extension
- Health check polling for server readiness
- Android intent handling for "Open with VSCodroid"

[Unreleased]: https://github.com/rmyndharis/VSCodroid/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/rmyndharis/VSCodroid/compare/v0.1.0-m0...v1.0.0
[0.1.0-m0]: https://github.com/rmyndharis/VSCodroid/releases/tag/v0.1.0-m0
