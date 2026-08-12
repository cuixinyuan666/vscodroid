#!/usr/bin/env bash
set -euo pipefail

# Cross-compiles the native addons the VS Code server needs into Bionic ARM64
# .node files. Every build — ours or Microsoft's — ships these compiled against
# glibc, and Android's loader cannot open them, so each one has to be replaced.
#
# Compiles by invoking NDK clang directly rather than going through node-gyp.
# node-gyp's generator injects host-specific flags (on macOS, -arch) that NDK
# clang rejects, and these addons are small enough that listing their sources
# costs less than fighting the generator.
#
#   ./scripts/build-native-addons.sh              # into assets/vscode-reh
#   OUTPUT_ROOT=/path/to/tree ./scripts/build-native-addons.sh
#
# Prerequisites: Android NDK r27+ (ANDROID_NDK_HOME, or the Android Studio SDK).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/.build/native-addons}"
OUTPUT_ROOT="${OUTPUT_ROOT:-$ROOT_DIR/android/app/src/main/assets/vscode-reh}"

# Must match remote/.npmrc `target` at the VS Code tag AND the bundled
# libnode.so. A mismatch changes NODE_MODULE_VERSION and every addon here is
# rejected at load with no useful message — terminals stop working and the log
# says only that a module could not be loaded. The check at the end compares the
# headers used here against the runtime actually being shipped, so the two
# cannot drift apart silently.
NODE_VERSION="${NODE_VERSION:-24.18.0}"

TARGET=aarch64-linux-android
API=33

# Android 16 requires 16 KB-aligned segments. NDK r28+ defaults to this and r27
# does not, so passing it explicitly is what makes the result independent of
# whichever NDK happens to be installed. The verify step below fails the build
# rather than trusting the default.
PAGE_SIZE_FLAGS=(-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384)

echo "=== Building native addons for Android ARM64 (Bionic) ==="

# --- Toolchain -------------------------------------------------------------

if [ -n "${ANDROID_NDK_HOME:-}" ]; then
    NDK_DIR="$ANDROID_NDK_HOME"
elif [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME/ndk" ]; then
    NDK_DIR="$(ls -d "$ANDROID_HOME/ndk/"* 2>/dev/null | sort -V | tail -1)"
elif [ -d "$HOME/Library/Android/sdk/ndk" ]; then
    NDK_DIR="$(ls -d "$HOME/Library/Android/sdk/ndk/"* 2>/dev/null | sort -V | tail -1)"
else
    echo "ERROR: Cannot find Android NDK. Set ANDROID_NDK_HOME." >&2
    exit 1
fi
[ -d "$NDK_DIR" ] || { echo "ERROR: NDK not at $NDK_DIR" >&2; exit 1; }

HOST_TAG="$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m)"
TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/$HOST_TAG"
# Google ships no darwin-arm64 or linux-aarch64 host toolchain; on Apple Silicon
# the x86_64 one runs under Rosetta.
[ -d "$TOOLCHAIN" ] || TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/darwin-x86_64"
[ -d "$TOOLCHAIN" ] || TOOLCHAIN="$NDK_DIR/toolchains/llvm/prebuilt/linux-x86_64"
[ -d "$TOOLCHAIN" ] || { echo "ERROR: no NDK host toolchain in $NDK_DIR" >&2; exit 1; }

CXX="$TOOLCHAIN/bin/$TARGET$API-clang++"
STRIP="$TOOLCHAIN/bin/llvm-strip"
READELF="$TOOLCHAIN/bin/llvm-readelf"
[ -x "$CXX" ] || { echo "ERROR: $CXX not found" >&2; exit 1; }

echo "  NDK    : $NDK_DIR"
echo "  target : $TARGET$API"
echo "  node   : v$NODE_VERSION headers"
echo "  output : $OUTPUT_ROOT"

# --- Node headers ----------------------------------------------------------

mkdir -p "$WORK_DIR"
NODE_INCLUDE="$WORK_DIR/node-v$NODE_VERSION/include/node"
if [ ! -d "$NODE_INCLUDE" ]; then
    echo ""
    echo "Downloading Node v$NODE_VERSION headers..."
    curl -fsSL --show-error \
        "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-headers.tar.gz" \
        | tar xz -C "$WORK_DIR"
fi
[ -d "$NODE_INCLUDE" ] || { echo "ERROR: headers missing at $NODE_INCLUDE" >&2; exit 1; }

# --- Build -----------------------------------------------------------------

# fetch <package> <version> -> echoes the unpacked source directory
fetch() {
    local pkg=$1 version=$2
    local dir="$WORK_DIR/src/${pkg//\//_}-$version"
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        ( cd "$dir" && npm pack "$pkg@$version" --quiet >/dev/null \
            && tar xzf ./*.tgz --strip-components=1 && rm -f ./*.tgz )
        # node-addon-api supplies napi.h; nothing else is needed to link.
        ( cd "$dir" && npm install --ignore-scripts --no-audit --no-fund --quiet >/dev/null 2>&1 || true )
    fi
    echo "$dir"
}

# compile <src-dir> <out.node> <sources...> -- <extra compiler flags...>
compile() {
    local src=$1 out=$2; shift 2
    local sources=() flags=()
    local seen_sep=0
    for arg in "$@"; do
        if [ "$arg" = "--" ]; then seen_sep=1; continue; fi
        if [ "$seen_sep" -eq 0 ]; then sources+=("$src/$arg"); else flags+=("$arg"); fi
    done

    mkdir -p "$(dirname "$out")"
    "$CXX" \
        -shared -fPIC -std=c++17 -O2 \
        -static-libstdc++ \
        "${PAGE_SIZE_FLAGS[@]}" \
        -DNAPI_VERSION=9 \
        -I"$NODE_INCLUDE" \
        -I"$src/node_modules/node-addon-api" \
        "${flags[@]}" \
        -o "$out" \
        "${sources[@]}"
    "$STRIP" "$out"
}

# verify <out.node> — a glibc dependency or a 4 KB segment must fail the build,
# not surface later as a dlopen error on a user's device.
verify() {
    local out=$1 name=$2

    # Shared with download-node.sh rather than reimplemented against the NDK's
    # readelf: an addon and the runtime that loads it have to agree about what
    # "loads on Android" means, and two copies of that judgement drift.
    python3 "$SCRIPT_DIR/verify-android-elf.py" "$out" || return 1
    printf '  ok   %-24s %8s bytes\n' "$name" "$(wc -c < "$out" | tr -d ' ')"
}

failed=0

# node-pty — the terminal. ptyHostMain imports it statically, so a failure here
# is not a degraded terminal, it is no terminal at all.
echo ""
echo "node-pty..."
PTY_SRC=$(fetch node-pty 1.1.0-beta22)
# Bionic has forkpty() in libc; binding.gyp's -lutil is for glibc only. Compiling
# directly means simply not passing it, so binding.gyp needs no patching.
compile "$PTY_SRC" "$OUTPUT_ROOT/node_modules/node-pty/build/Release/pty.node" \
    src/unix/pty.cc \
    -- -DNODE_ADDON_API_DISABLE_DEPRECATED -DNODE_GYP_MODULE_NAME=pty
verify "$OUTPUT_ROOT/node_modules/node-pty/build/Release/pty.node" node-pty || failed=1

# @parcel/watcher — recursive file watching. watcherMain imports it statically
# too, so without it recursive watching is dead rather than degraded, and an
# extension is simply never told a file changed.
echo ""
echo "@parcel/watcher..."
WATCHER_SRC=$(fetch @parcel/watcher 2.1.0)
# Sources and defines are binding.gyp's OS=="linux" branch. Android has inotify,
# so that backend is the one that matters; watchman stays compiled in and inert
# because nothing serves its socket here.
compile "$WATCHER_SRC" "$OUTPUT_ROOT/node_modules/@parcel/watcher/build/Release/watcher.node" \
    src/binding.cc src/Watcher.cc src/Backend.cc src/DirTree.cc src/Glob.cc \
    src/watchman/BSER.cc src/watchman/WatchmanBackend.cc \
    src/shared/BruteForceBackend.cc src/linux/InotifyBackend.cc src/unix/legacy.cc \
    -- -fexceptions -DNAPI_DISABLE_CPP_EXCEPTIONS \
       -DWATCHMAN -DINOTIFY -DBRUTE_FORCE -DNODE_GYP_MODULE_NAME=watcher
verify "$OUTPUT_ROOT/node_modules/@parcel/watcher/build/Release/watcher.node" @parcel/watcher || failed=1

echo ""
[ "$failed" -eq 0 ] || { echo "=== FAILED ==="; exit 1; }
echo "=== Native addons built ==="
