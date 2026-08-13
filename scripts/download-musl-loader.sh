#!/usr/bin/env bash
set -euo pipefail

# Bundles musl's dynamic loader, which is how the Claude Code CLI runs here.
#
#   ./scripts/download-musl-loader.sh
#
# The CLI ships as a per-platform native binary and the marketplace serves two
# Linux flavours of it. Only the musl one can run on Android, and only through
# this loader. Both halves of that were measured on an API 36 emulator:
#
#   * The glibc build dies before main() with SIGSYS. glibc's __tls_init_tp
#     calls set_robust_list and rseq, and Android's app seccomp filter rejects
#     both. Nothing configurable avoids it -- the rseq tunable still leaves
#     set_robust_list, which has no tunable. The musl build makes neither call.
#
#   * SELinux refuses execve() of anything under filesDir for targetSdk >= 29
#     (no execute_no_trans on app_data_file), and an extension the user installs
#     lands exactly there. It does grant map and execute, though, which is all a
#     loader needs: execve the loader from nativeLibraryDir, where execution is
#     allowed, and let it mmap the payload out of filesDir.
#
# The two fit together neatly because resolveClaudeBinary() passes the resolved
# binary path as the wrapper's first argument, which is already the loader's
# calling convention -- so claudeCode.claudeProcessWrapper points straight at
# this file and no shim script sits in between.
#
# musl is MIT, so unlike the CLI itself this is ours to redistribute.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
JNI_DIR="$ROOT_DIR/android/app/src/main/jniLibs/arm64-v8a"
WORK_DIR="$ROOT_DIR/toolchains/musl"

ALPINE_BRANCH="${ALPINE_BRANCH:-v3.20}"
MIRROR="https://dl-cdn.alpinelinux.org/alpine/$ALPINE_BRANCH/main/aarch64"

echo "=== musl loader ==="
mkdir -p "$WORK_DIR" "$JNI_DIR"

# Resolve the current musl version from the branch index rather than pinning a
# release, the same way the Python download resolves its version from Termux's.
echo "--- Resolving musl version from $ALPINE_BRANCH ---"
curl -sL --fail --show-error -o "$WORK_DIR/APKINDEX.tar.gz" "$MIRROR/APKINDEX.tar.gz"
# Unpacked to a file rather than piped: the parser stops at the first match, and
# closing the pipe early makes tar fail the whole script under `set -o pipefail`.
tar xzf "$WORK_DIR/APKINDEX.tar.gz" -C "$WORK_DIR" APKINDEX
MUSL_VERSION=$(awk -v RS='' '/(^|\n)P:musl\n/ { for (i = 1; i <= NF; i++) if ($i ~ /^V:/) { print substr($i, 3); exit } }' "$WORK_DIR/APKINDEX")
# The strongest digest APKINDEX carries: C: is "Q1" + base64(SHA1). SHA1 is
# below today's bar but it is what Alpine publishes for v2 indexes, and a
# stale or truncated mirror file still fails it -- checking it beats trusting
# the transport. Noted as a limitation rather than silently accepted.
MUSL_C1=$(awk -v RS='' '/(^|\n)P:musl\n/ { for (i = 1; i <= NF; i++) if ($i ~ /^C:/) { print substr($i, 3); exit } }' "$WORK_DIR/APKINDEX")

if [ -z "$MUSL_VERSION" ]; then
    echo "  ERROR: no musl package in the $ALPINE_BRANCH index." >&2
    exit 1
fi
echo "  version   : $MUSL_VERSION"

APK="$WORK_DIR/musl-$MUSL_VERSION.apk"
if [ ! -f "$APK" ]; then
    curl -sL --fail --show-error -o "$APK" "$MIRROR/musl-$MUSL_VERSION.apk"
fi
if [ -n "$MUSL_C1" ]; then
    # An .apk is three concatenated gzip streams -- signature, control, data --
    # and C: is the SHA1 of the CONTROL stream alone, not of the file. Hashing
    # the whole file fails against a perfectly good package.
    actual=$(python3 - "$APK" <<'PY'
import base64, hashlib, sys, zlib
data = open(sys.argv[1], "rb").read()
bounds, i = [], 0
for _ in range(3):
    d = zlib.decompressobj(31)
    d.decompress(data[i:])
    end = len(data) - len(d.unused_data)
    bounds.append((i, end))
    i = end
control = data[bounds[0][1]:bounds[1][1]]
print("Q1" + base64.b64encode(hashlib.sha1(control).digest()).decode())
PY
)
    if [ "$actual" != "$MUSL_C1" ]; then
        echo "  ERROR: musl-$MUSL_VERSION.apk does not match the index" >&2
        echo "    index : $MUSL_C1" >&2
        echo "    file  : $actual" >&2
        rm -f "$APK"
        exit 1
    fi
    echo "  checksum  : verified (SHA1, the strongest APKINDEX offers)"
else
    echo "  WARNING: index carries no checksum for musl; downloaded unverified" >&2
fi

# An .apk is a gzipped tar. In musl the loader and libc are one file, so this is
# the only artifact needed -- it satisfies its own DT_NEEDED and runs with no
# LD_LIBRARY_PATH, which was verified on device.
rm -rf "$WORK_DIR/extract"
mkdir -p "$WORK_DIR/extract"
tar xzf "$APK" -C "$WORK_DIR/extract" lib/ld-musl-aarch64.so.1 2>/dev/null

SRC="$WORK_DIR/extract/lib/ld-musl-aarch64.so.1"
if [ ! -f "$SRC" ]; then
    echo "  ERROR: lib/ld-musl-aarch64.so.1 is not in musl-$MUSL_VERSION.apk." >&2
    exit 1
fi

# Named lib*.so so the Package Manager extracts it to nativeLibraryDir with the
# execute bit; that directory is the only one an app may execve from.
cp "$SRC" "$JNI_DIR/libldmusl.so"
chmod 755 "$JNI_DIR/libldmusl.so"
echo "  installed : jniLibs/arm64-v8a/libldmusl.so ($(du -h "$JNI_DIR/libldmusl.so" | cut -f1))"

python3 "$SCRIPT_DIR/verify-android-elf.py" "$JNI_DIR/libldmusl.so"

echo ""
echo "=== musl loader ready ==="
echo "  claudeCode.claudeProcessWrapper must point at this file; FirstRunSetup writes it."
