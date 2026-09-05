#!/usr/bin/env bash
set -euo pipefail

# Places the bundled OpenCode CLI into jniLibs so the app can execve it.
#
#   ./scripts/fetch-opencode.sh
#
# OpenCode is a Bun standalone binary. SELinux will not execve anything under
# filesDir, so the payload has to live in nativeLibraryDir as libopencode.so,
# the same packaging trick node, bash and git already use. usr/bin/opencode is
# then a symlink onto that file, created at launch by setupToolSymlinks.
#
# The ~141 MiB binary is not in git (GitHub's file limit is 100 MiB). It is
# published as the opencode-payload release of this fork and checked here by
# sha256. The JS graph inside it is already patched: tmp and cache live under
# HOME, and OpenTUI is loaded from $OPENTUI_LIB_PATH. Do not strip this file:
# the compiled app is an overlay after the ELF, and AGP strip drops it.
#
# OPENCODE_PAYLOAD_URL overrides the download. OPENCODE_PAYLOAD_FILE points at
# a zip you already have, which is how a machine without network can still
# produce the same tree.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
JNI_DIR="$ROOT_DIR/android/app/src/main/jniLibs/arm64-v8a"
NOTICE_DIR="$ROOT_DIR/android/app/src/main/assets/usr/share/doc/opencode"
CACHE_DIR="$ROOT_DIR/toolchains/opencode"
ZIP_NAME="opencode-android-aarch64.zip"
ZIP="$CACHE_DIR/$ZIP_NAME"

# cuixinyuan666/vscodroid, not the upstream Play tree: that repository does not
# publish this payload.
OPENCODE_PAYLOAD_URL="${OPENCODE_PAYLOAD_URL:-https://github.com/cuixinyuan666/vscodroid/releases/download/opencode-payload/opencode-android-aarch64.zip}"
OPENCODE_PAYLOAD_SHA256="${OPENCODE_PAYLOAD_SHA256:-83428bd233ae79a2317cf098fab1440bb91fcb9dbbb6286770eb1bdda4490b61}"

echo "=== OpenCode CLI ==="
echo "  url    : $OPENCODE_PAYLOAD_URL"

mkdir -p "$JNI_DIR" "$CACHE_DIR" "$NOTICE_DIR"

sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

if [ -n "${OPENCODE_PAYLOAD_FILE:-}" ]; then
    ZIP="$OPENCODE_PAYLOAD_FILE"
    echo "  file   : $ZIP"
    if [ ! -f "$ZIP" ]; then
        echo "  ERROR: OPENCODE_PAYLOAD_FILE is set but $ZIP is missing" >&2
        exit 1
    fi
else
    if [ -f "$ZIP" ]; then
        got="$(sha256_of "$ZIP")"
        if [ "$got" = "$OPENCODE_PAYLOAD_SHA256" ]; then
            echo "  cache  : $ZIP"
        else
            echo "  cache digest $got does not match $OPENCODE_PAYLOAD_SHA256; refetching"
            rm -f "$ZIP"
        fi
    fi
    if [ ! -f "$ZIP" ]; then
        echo "  fetch  : $OPENCODE_PAYLOAD_URL"
        curl -fsSL -o "$ZIP.partial" "$OPENCODE_PAYLOAD_URL"
        mv "$ZIP.partial" "$ZIP"
    fi
fi

got="$(sha256_of "$ZIP")"
if [ "$got" != "$OPENCODE_PAYLOAD_SHA256" ]; then
    echo "  ERROR: $ZIP hashed to $got, expected $OPENCODE_PAYLOAD_SHA256" >&2
    exit 1
fi
echo "  sha256 : $got"

WORKDIR="$CACHE_DIR/unpacked"
rm -rf "$WORKDIR"
mkdir -p "$WORKDIR"
# -o overwrites; the tree is disposable. -q keeps the log a digest and a path.
unzip -o -q "$ZIP" -d "$WORKDIR"

for name in libopencode.so libopentui.so; do
    src="$WORKDIR/$name"
    if [ ! -f "$src" ]; then
        echo "  ERROR: $ZIP has no $name" >&2
        exit 1
    fi
    cp "$src" "$JNI_DIR/$name"
    echo "  placed : $JNI_DIR/$name ($(wc -c < "$JNI_DIR/$name" | tr -d ' ') bytes)"
done

cp "$ROOT_DIR/licenses/LICENSE.opencode" "$NOTICE_DIR/LICENSE"
echo "  notice : $NOTICE_DIR/LICENSE"

echo ""
echo "=== Verify ==="
python3 "$SCRIPT_DIR/verify-android-elf.py" "$JNI_DIR/libopencode.so" --lib-dir "$JNI_DIR"
python3 "$SCRIPT_DIR/verify-android-elf.py" "$JNI_DIR/libopentui.so" --lib-dir "$JNI_DIR"
