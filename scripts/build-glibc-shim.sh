#!/usr/bin/env bash
set -euo pipefail

# Builds the compatibility layer that lets glibc-built Linux addons load under
# Bionic.
#
#   ANDROID_NDK_HOME=... ./scripts/build-glibc-shim.sh
#
# Two pieces, and the second one is the trick:
#
#   libglibc-shim.so    the symbols Bionic does not have, from glibc-shim.c
#   libc.so.6 &c        stubs carrying the names a glibc binary asks for
#
# A prebuilt linux-arm64 addon is machine code Android can run -- same ISA, same
# calling convention -- and the only thing stopping it is the loader. Its
# DT_NEEDED names are glibc's (libc.so.6, libdl.so.2, libpthread.so.0, ...) and
# none of them exist here, so dlopen fails before a single instruction runs.
#
# Each stub is an empty library that depends on Bionic's libc and on the shim.
# Loading it therefore pulls both into the process, and the addon's imports
# resolve from the global namespace: the ordinary ones (memcpy, pthread_create,
# fopen) from Bionic, the glibc-only ones from the shim. Bionic long ago merged
# libdl, libpthread, libm and librt into libc, which is why one stub body serves
# for all of them.
#
# This is a compatibility shim, not an emulator. It works because the two libcs
# agree on the ABI that matters. Where they do not -- a struct laid out
# differently, a symbol whose semantics diverge -- an addon can still misbehave
# in ways nothing here would catch, so anything relying on it needs testing on a
# device rather than trust.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/android/app/src/main/assets/usr/lib}"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/.build/glibc-shim}"

TARGET=aarch64-linux-android
API=33

# The names a glibc-linked binary carries in DT_NEEDED. Bionic folded all of
# these into libc, so every stub has the same (empty) body.
STUBS=(libc.so.6 libdl.so.2 libpthread.so.0 libm.so.6 librt.so.1 libutil.so.1
       libgcc_s.so.1 libresolv.so.2 libcrypt.so.1 ld-linux-aarch64.so.1)

echo "=== glibc compatibility shim ==="

case "$(uname -s)" in
    Darwin) HOST_TAG=darwin-x86_64 ;;
    Linux)  HOST_TAG=linux-x86_64 ;;
    *) echo "  ERROR: unsupported host $(uname -s)" >&2; exit 1 ;;
esac

NDK="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [ -z "$NDK" ] || [ ! -d "$NDK" ]; then
    echo "  ERROR: set ANDROID_NDK_HOME to an installed NDK" >&2
    exit 1
fi

CC="$NDK/toolchains/llvm/prebuilt/$HOST_TAG/bin/${TARGET}${API}-clang"
if [ ! -x "$CC" ]; then
    echo "  ERROR: no compiler at $CC" >&2
    exit 1
fi
echo "  ndk    : $NDK"

mkdir -p "$WORK_DIR" "$OUT_DIR"

# Android 16 requires 16 KB-aligned segments; NDK 27 still defaults to 4 KB.
PAGE_SIZE_FLAGS=(-Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384)

echo ""
echo "--- libglibc-shim.so ---"
# -soname because the library now looks itself up by name at load time, to fill
# the trampolines for the symbols only it defines. Without one the loader
# registers it under whatever string happened to be requested; naming it here
# makes that identity stated rather than incidental. The stubs already record
# exactly this in DT_NEEDED, so nothing else changes.
"$CC" -shared -fPIC -O2 -Wall \
    -o "$OUT_DIR/libglibc-shim.so" \
    "$SCRIPT_DIR/glibc-shim.c" \
    -Wl,-soname,libglibc-shim.so \
    -llog \
    "${PAGE_SIZE_FLAGS[@]}"
echo "  $(wc -c < "$OUT_DIR/libglibc-shim.so" | tr -d ' ') bytes"

echo ""
echo "--- forwarders ---"
# Generated from the addons themselves, not from a list kept here. What a glibc
# binary imports, and at which version, is a property of how it was built; a
# hand-maintained list would drift the first time one is updated.
GEN_DIR="$WORK_DIR/generated"
rm -rf "$GEN_DIR"
if [ "$#" -gt 0 ]; then
    python3 "$SCRIPT_DIR/gen-glibc-forwarders.py" "$@" --out "$GEN_DIR"
else
    echo "  no addons given, so the stubs will carry names but no symbols"
    echo "  pass objects directly, or --scan a directory to search"
fi

echo ""
echo "--- stub libraries ---"
: > "$WORK_DIR/empty.c"
for stub in "${STUBS[@]}"; do
    src="$WORK_DIR/empty.c"
    version_script=()
    generated="$GEN_DIR/${stub//./_}.c"
    if [ -f "$generated" ]; then
        src="$generated"
        version_script=(-Wl,--version-script="$GEN_DIR/${stub//./_}.map")
    fi
    # -soname is what the loader records and matches against, so it has to be
    # the glibc name rather than the file name it happens to be written to.
    "$CC" -shared -fPIC -O2 \
        -o "$OUT_DIR/$stub" \
        "$src" \
        -Wl,-soname,"$stub" \
        ${version_script[@]+"${version_script[@]}"} \
        -L"$OUT_DIR" -lglibc-shim -llog \
        "${PAGE_SIZE_FLAGS[@]}"
    printf '  %-18s %8s bytes%s\n' "$stub" "$(wc -c < "$OUT_DIR/$stub" | tr -d ' ')" \
        "$([ -f "$generated" ] && echo '  (versioned forwarders)' || echo '')"
done

echo ""
echo "=== Verify ==="
python3 "$SCRIPT_DIR/verify-android-elf.py" "$OUT_DIR/libglibc-shim.so" --lib-dir "$OUT_DIR"
