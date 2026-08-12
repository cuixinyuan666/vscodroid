#!/usr/bin/env bash
set -euo pipefail

# Builds Code - OSS into a vscode-reh-web server tree.
#
# Runs inside the image from docker/codeoss-build.Dockerfile, which supplies the
# Node from VS Code's .nvmrc and the native toolchain. Run it with a named volume
# rather than a bind mount — npm ci writes on the order of 100k files, and a
# Docker Desktop bind mount makes that pathologically slow:
#
#   docker volume create vscodroid-codeoss
#   docker run --rm -v vscodroid-codeoss:/work \
#       -v "$PWD/scripts/build-vscode-oss.sh:/build.sh:ro" \
#       vscodroid-codeoss-build:20.18.0 bash /build.sh
#
# This produces an unbranded, unpatched tree on purpose. Branding and the Android
# adaptations are applied on top; keeping this stage clean is what makes it
# possible to tell a build failure apart from a patch failure.

VSCODE_VERSION="${VSCODE_VERSION:-1.96.4}"
ARCH="${ARCH:-arm64}"
WORK="${WORK:-/work}"

SRC="$WORK/vscode"
# gulpfile.reh.js: BUILD_ROOT = path.dirname(REPO_ROOT), and destinationFolderName
# carries no `min` suffix — the min and non-min variants share this directory.
OUT="$WORK/vscode-reh-web-linux-$ARCH"

step() { printf '\n=== %s ===\n' "$1"; }
elapsed() { printf '  took %dm%02ds\n' $(( $1 / 60 )) $(( $1 % 60 )); }

step "Environment"
echo "  vscode      : $VSCODE_VERSION"
echo "  target arch : linux-$ARCH"
echo "  build arch  : $(uname -m)"
echo "  node        : $(node --version)   (expected: $(cat "$SRC/.nvmrc" 2>/dev/null || echo 'checked below'))"
df -h "$WORK" | tail -1 | awk '{print "  disk free   : "$4" of "$2}'

step "Source"
if [ ! -d "$SRC/.git" ]; then
    t0=$SECONDS
    git clone --depth 1 --branch "$VSCODE_VERSION" \
        https://github.com/microsoft/vscode.git "$SRC"
    elapsed $(( SECONDS - t0 ))
else
    echo "  already cloned"
fi
cd "$SRC"
echo "  HEAD    : $(git rev-parse --short HEAD)"
echo "  .nvmrc  : $(cat .nvmrc)"
[ "v$(cat .nvmrc)" = "$(node --version)" ] || echo "  WARNING: node does not match .nvmrc"

step "Dependencies (npm ci)"
t0=$SECONDS
npm ci
elapsed $(( SECONDS - t0 ))
du -sh node_modules remote/node_modules 2>/dev/null | sed 's/^/  /'

step "Build (gulp vscode-reh-web-linux-$ARCH-min)"
# The -min task chains compile, bundle, minify and package. The -min-ci variant
# is only the packaging tail — it skips compileBuildTask and minifyTask entirely
# (gulpfile.reh.js:470-486), so it is correct only when an earlier job already
# produced out-vscode-reh-web-min.
t0=$SECONDS
npm run gulp "vscode-reh-web-linux-$ARCH-min"
elapsed $(( SECONDS - t0 ))

step "Verify"
fail=0
# The three paths VSCodroid actually loads. A build that misses any of them is
# broken for us no matter how green gulp was.
for p in out/server-main.js product.json node_modules/@vscode/ripgrep/bin; do
    if [ -e "$OUT/$p" ]; then
        echo "  ok      $p"
    else
        echo "  MISSING $p"
        fail=1
    fi
done

# vsda is the signing addon that only ships in Microsoft's build. Its presence
# would mean this tree is not the OSS one we think it is.
if [ -e "$OUT/node_modules/vsda" ]; then
    echo "  UNEXPECTED node_modules/vsda — this is not an OSS tree"
    fail=1
else
    echo "  ok      no vsda"
fi

echo
echo "  output  : $OUT"
du -sh "$OUT" | awk '{print "  size    : "$1}'
df -h "$WORK" | tail -1 | awk '{print "  disk free after: "$4}'

[ "$fail" -eq 0 ] || { echo; echo "VERIFY FAILED"; exit 1; }
echo
echo "=== Code - OSS reh-web build complete ==="
