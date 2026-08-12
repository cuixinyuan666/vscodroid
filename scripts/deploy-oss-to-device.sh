#!/usr/bin/env bash
set -euo pipefail

# Swaps the Code - OSS server tree onto a connected device, in place of whatever
# is installed, and swaps it back.
#
#   ./scripts/deploy-oss-to-device.sh            # deploy
#   ./scripts/deploy-oss-to-device.sh restore    # put the previous tree back
#
# For the pivot's testing loop only. The tree comes from the Docker volume the
# build writes to, and the app's own first-run extraction is bypassed entirely —
# nothing here belongs in a release path.
#
# The first tree seen is kept as vscode-reh.bak, so restoring is a rename and
# costs nothing. Reinstalling the APK does not restore it: extraction is gated on
# versionName, so a same-version install leaves whatever is on disk.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PKG="${PKG:-com.vscodroid.debug}"
VOLUME="${VOLUME:-vscodroid-codeoss}"
IMAGE="${IMAGE:-vscodroid-codeoss-build:20.18.0}"
TREE="${TREE:-vscode-reh-web-linux-arm64}"

FILES="/data/user/0/$PKG/files"
ADDONS="$ROOT_DIR/android/app/src/main/assets/vscode-reh/node_modules"
STAGE="$ROOT_DIR/.build/device-deploy"

# adb shell mangles quoting badly enough that anything beyond a single word is
# unreliable; every multi-step action here is pushed as a file and run by path.
run_script() {
    local name=$1 body=$2
    printf '%s' "$body" > "$STAGE/$name"
    "$ADB" push "$STAGE/$name" "/data/local/tmp/$name" >/dev/null
    "$ADB" shell run-as "$PKG" sh "/data/local/tmp/$name"
}

mkdir -p "$STAGE"

if [ "${1:-deploy}" = "restore" ]; then
    run_script restore.sh "#!/system/bin/sh
set -e
[ -d '$FILES/server/vscode-reh.bak' ] || { echo '  no backup to restore'; exit 1; }
rm -rf '$FILES/server/vscode-reh'
mv '$FILES/server/vscode-reh.bak' '$FILES/server/vscode-reh'
echo \"  restored: \$(du -sh '$FILES/server/vscode-reh' | cut -f1)\"
"
    "$ADB" shell am force-stop "$PKG"
    echo "=== restored ==="
    exit 0
fi

echo "=== Packaging $TREE ==="
# The build leaves glibc addons in the tree; overlay the Bionic ones we compiled
# before shipping it anywhere, or the terminal and the file watcher both die.
docker run --rm \
    -v "$VOLUME:/work" \
    -v "$ADDONS/node-pty/build/Release/pty.node:/addons/pty.node:ro" \
    -v "$ADDONS/@parcel/watcher/build/Release/watcher.node:/addons/watcher.node:ro" \
    -v "$STAGE:/export" \
    "$IMAGE" bash -c "
set -e
O=/work/$TREE
cp /addons/pty.node     \"\$O/node_modules/node-pty/build/Release/pty.node\"
cp /addons/watcher.node \"\$O/node_modules/@parcel/watcher/build/Release/watcher.node\"
cd /work && tar czf /export/oss.tar.gz $TREE
"
echo "  $(du -h "$STAGE/oss.tar.gz" | cut -f1)"

echo "=== Deploying to $PKG ==="
"$ADB" shell am force-stop "$PKG"
"$ADB" push "$STAGE/oss.tar.gz" /data/local/tmp/oss.tar.gz >/dev/null

# ripgrep is a symlink into nativeLibraryDir that FirstRunSetup maintains; it
# lives inside the tree being replaced, so it has to be recreated here.
NLD="$("$ADB" shell run-as "$PKG" readlink "$FILES/usr/bin/bash" | tr -d '\r' | xargs dirname)"

run_script deploy.sh "#!/system/bin/sh
set -e
S='$FILES/server'
# Keep the FIRST backup, not the most recent. The tree worth being able to go back
# to is the one the app installed itself; overwriting it on every deploy means the
# second run replaces it with the previous experiment. Recovering it then means
# unpacking the APK by hand, because first-run extraction is gated on versionName
# and a same-version reinstall skips it.
if [ -d \"\$S/vscode-reh\" ]; then
    if [ -d \"\$S/vscode-reh.bak\" ]; then
        rm -rf \"\$S/vscode-reh\"
    else
        mv \"\$S/vscode-reh\" \"\$S/vscode-reh.bak\"
    fi
fi
cd \"\$S\"
tar xzf /data/local/tmp/oss.tar.gz
mv '$TREE' vscode-reh
RG=\"\$S/vscode-reh/node_modules/@vscode/ripgrep/bin/rg\"
rm -f \"\$RG\"
ln -s '$NLD/libripgrep.so' \"\$RG\"
echo \"  deployed: \$(du -sh \$S/vscode-reh | cut -f1)\"
echo \"  backup  : \$(du -sh \$S/vscode-reh.bak 2>/dev/null | cut -f1)\"
echo \"  vsda    : \$(test -d \$S/vscode-reh/node_modules/vsda && echo present || echo absent)\"
"

echo "=== Deployed. Launch with: ==="
echo "  $ADB shell am start -n $PKG/com.vscodroid.SplashActivity"
