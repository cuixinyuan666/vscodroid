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
#   docker volume create vscodroid-npm-cache
#   docker run --rm -v vscodroid-codeoss:/work \
#       -v vscodroid-npm-cache:/root/.npm \
#       -e VSCODE_VERSION="$(cat VSCODE_VERSION)" \
#       -v "$PWD/scripts:/scripts:ro" \
#       -v "$PWD/branding:/branding" \
#       -v "$PWD/patches:/patches:ro" \
#       vscodroid-codeoss-build:24.18.0 bash /scripts/build-vscode-oss.sh
#
# Run it on an arm64 host. Every native module in the tree is built for the build
# host, and only two of them are overlaid afterwards by build-native-addons.sh —
# ripgrep in particular is downloaded by its own postinstall for whatever
# os.platform()/arch() reports. The Verify stage refuses to finish an x86-64
# tree rather than let one reach a device, where it fails at exec.
#
# Patches and branding are both applied to the source before gulp runs, so their
# effects are baked in wherever the build inlines them rather than only where a
# later regex reaches. Each stage prints what it did and fails the build if it
# could not, so a broken build is attributable to a stage rather than discovered
# on a device.

# No default. The pin lives in the repo's VSCODE_VERSION file and is passed in;
# a second copy here is a second thing to forget when the version moves.
VSCODE_VERSION="${VSCODE_VERSION:?pass it in from the repo VSCODE_VERSION file}"
ARCH="${ARCH:-arm64}"
WORK="${WORK:-/work}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

step "Patches"
# The Android adaptations, as real diffs against readable source. git apply exits
# non-zero when the context has shifted, and set -e turns that into a failed
# build — which is the whole reason these are moving here from regexes against
# minified output, where a stale pattern printed SKIP and exited 0.
#
# Applied to a clean tree every time, so a rerun does not fail on already-applied
# hunks and cannot accumulate half-states. All three steps are needed, and the
# first is the one that is easy to miss: a patch that adds a file leaves it
# staged, where neither checkout nor clean will touch it, and the next run dies
# with "already exists in working directory".
PATCHES="${PATCHES:-/patches}"
if [ -d "$PATCHES" ] && [ -n "$(ls -A "$PATCHES"/*.patch 2>/dev/null)" ]; then
    # build/ as well as src/: patches reach the build tooling too, and a tree
    # reset that misses one of them fails the next run on an applied hunk.
    git -C "$SRC" reset -q 2>/dev/null || true
    git -C "$SRC" checkout -- src/ build/ 2>/dev/null || true
    git -C "$SRC" clean -fdq src/ build/ 2>/dev/null || true
    for patch in "$PATCHES"/*.patch; do
        git -C "$SRC" apply --verbose "$patch" 2>&1 | sed 's/^/  /'
        echo "  applied $(basename "$patch")"
    done
else
    echo "  no patches at $PATCHES — building unadapted"
fi

step "Branding"
# Skippable so the stage can be run bare when isolating a build problem.
BRANDING="${BRANDING:-/branding}"
if [ -d "$BRANDING" ]; then
    # Restore what this stage overwrites before overwriting it. The overlay is
    # applied with update(), so on a reused work volume it merges into the
    # previous run's output — which means a key REMOVED from the overlay stays in
    # the file forever, and the stage silently stops matching what it declares.
    # That cost three build attempts: extensionsGallery was dropped from the
    # overlay and the build kept downloading builtin extensions from Open VSX.
    git -C "$SRC" checkout -- product.json resources/server/ 2>/dev/null || true
    python3 - "$BRANDING/product.json" "$SRC/product.json" <<'PY'
import json, sys

overlay_path, product_path = sys.argv[1], sys.argv[2]
overlay = json.load(open(overlay_path))
product = json.load(open(product_path))

removed = [k for k in overlay.get("remove", []) if product.pop(k, None) is not None]
product.update(overlay.get("set", {}))

# Two spaces and a trailing newline: this file is read by humans when a build
# behaves oddly, and gulp only cares that it parses.
with open(product_path, "w") as f:
    json.dump(product, f, indent=2)
    f.write("\n")

print(f"  product.json: {len(overlay.get('set', {}))} set, {len(removed)} removed, {len(product)} keys")
for key in ("nameLong", "applicationName", "urlProtocol"):
    print(f"    {key} = {product[key]}")
PY

    # gulpfile.reh.js:343-351 copies these four into the reh-web package as they
    # are. Upstream they are Microsoft's VS Code icon and name, which must not
    # travel with this app. The filenames are fixed by that same gulp task.
    for asset in manifest.json code-192.png code-512.png favicon.ico; do
        if [ -f "$BRANDING/server/$asset" ]; then
            cp "$BRANDING/server/$asset" "$SRC/resources/server/$asset"
            echo "  resources/server/$asset"
        else
            echo "  WARNING: $BRANDING/server/$asset missing, keeping upstream" >&2
        fi
    done
else
    echo "  no branding at $BRANDING — building unbranded"
fi

step "Dependencies (npm ci)"
# Around 3 GB over the wire, and a single reset anywhere in it fails the whole
# stage — which then costs another full download to retry. npm's own retry only
# covers individual requests, so the stage is retried as a whole too. Mount a
# volume at /root/.npm (see the header) and a retry resumes from cache instead of
# starting over.
t0=$SECONDS
for attempt in 1 2 3; do
    if npm ci --fetch-retries=5 --fetch-retry-mintimeout=10000 \
              --fetch-retry-maxtimeout=120000 --prefer-offline; then
        break
    fi
    if [ "$attempt" = 3 ]; then
        echo "  npm ci failed three times; the last error is above" >&2
        exit 1
    fi
    echo "  npm ci failed, retrying ($attempt/3)" >&2
done
elapsed $(( SECONDS - t0 ))
du -sh node_modules remote/node_modules 2>/dev/null | sed 's/^/  /'

step "Build (core-ci)"
# Two tasks, in the order Microsoft's own pipelines run them, and NOT the single
# `vscode-reh-web-linux-$ARCH-min` that looks like the obvious entry point.
#
# That task still exists but nothing at Microsoft calls it: every shipping
# pipeline runs `core-ci` and then the `-min-ci` packaging tail
# (product-build-linux-compile.yml:211,311, and the darwin/win32/alpine
# equivalents). `core-ci` is esbuild -- tsgo type-check, transpile, then bundle
# straight into out-vscode-reh-web-min. The legacy gulp-and-mangler chain was
# renamed `core-ci-old` (gulpfile.vscode.ts:195) and is invoked by nothing.
#
# Calling `-min` cost eight failed builds, and every failure was in that
# abandoned path: the mangler's protected-fields gate, 168 compile errors from
# tests indexing private fields the mangler had renamed, 14 more from
# dynamic-import destructuring, and a non-ASCII check inside a minify step
# core-ci never runs. Microsoft says as much in
# .github/instructions/buildNext.instructions.md: "The new build doesn't do
# TypeScript-based mangling yet."
t0=$SECONDS
npm run gulp core-ci
elapsed $(( SECONDS - t0 ))

step "Package (vscode-reh-web-linux-$ARCH-min-ci)"
# Packaging only -- native extensions, the node download, the copy into place.
# Correct precisely because core-ci has already produced out-vscode-reh-web-min.
t0=$SECONDS
npm run gulp "vscode-reh-web-linux-$ARCH-min-ci"
elapsed $(( SECONDS - t0 ))
step "Prune"
# The node-linux-arm64 gulp task downloads a GNU/Linux Node and packageTask ships
# it. Its interpreter (/lib/ld-linux-aarch64.so.1) does not exist on Android and
# nothing here references it — the runtime uses nativeLibraryDir/libnode.so. The
# OSS build produces it byte-for-byte the same as the proprietary one, so the
# pivot does not remove it and this stays a post-build step. Doing it here rather
# than patching the gulpfile keeps it upright across version bumps.
if [ -f "$OUT/node" ]; then
    size=$(du -h "$OUT/node" | cut -f1)
    rm -f "$OUT/node"
    echo "  removed the unusable GNU/Linux node binary ($size)"
fi

# gulp's reh-web package task leaves both of these behind, and product.json still
# names one of them in licenseFileName. Code - OSS is MIT, and MIT asks that the
# copyright notice travel with the copies — this tree is redistributed inside
# every APK, so the notice has to be in it.
for f in LICENSE.txt ThirdPartyNotices.txt; do
    if [ -f "$SRC/$f" ]; then
        cp "$SRC/$f" "$OUT/$f"
        echo "  added $f"
    fi
done

step "Verify"
fail=0

# Tree shape, branding and native architecture are checked by the same script the
# fetcher runs, so what is proven here is exactly what is proven again on the way
# into an APK. The build-specific checks — that each patch survived into the
# packaged bundles, and that the product.json key set has not drifted — stay here,
# because only this side has the patches and the expectation file.
python3 "$SCRIPT_DIR/verify-server-tree.py" "$OUT" || fail=1

# Applying a patch to the source proves nothing about the package: the file may
# not be in this target's graph, or the build may inline an older copy. Each
# patch therefore leaves a fingerprint that has to survive minification, and the
# packaged output is searched for it.
if [ -d "$PATCHES" ] && [ -n "$(ls -A "$PATCHES"/*.patch 2>/dev/null)" ]; then
    # patch | bundle it must reach | fingerprint that survives minification
    # Not every patch leaves one: 0007 flips a single boolean and its only
    # distinctive text is a comment, which minification strips. An absent row is
    # deliberate, not an oversight.
    while IFS='|' read -r id bundle pattern; do
        [ -z "$id" ] && continue
        if [ -f "$OUT/$bundle" ] && grep -q "$pattern" "$OUT/$bundle"; then
            echo "  ok      $id reached $(basename "$bundle")"
        else
            echo "  FAIL    $id did not reach $bundle"
            fail=1
        fi
    done <<'FINGERPRINTS'
0001 platform|out/server-main.js|platform==="android"
0002 userDataPath|out/vs/platform/terminal/node/ptyHostMain.js|case"android"
0003 ptyHost worker|out/server-main.js|__vsc_disconnect
0004 extHost worker|out/server-main.js|worker_thread Extension Host
0005 webview csp|out/vs/workbench/contrib/webview/browser/pre/index.html|script-src 'unsafe-inline'
0006 callback relay|out/vs/code/browser/workbench/callback.html|intent://callback
0008 activitybar height|out/vs/code/browser/workbench/workbench.js|.activitybar .composite-bar
0009 alpine target|out/server-main.js|Android: requesting the alpine target platform
FINGERPRINTS
fi

if [ -d "$BRANDING" ]; then
    python3 - "$OUT/product.json" "$OUT/resources/server/manifest.json" \
             "$BRANDING/product-keys.expected" <<'PY' || fail=1
import json, sys

product = json.load(open(sys.argv[1]))
manifest = json.load(open(sys.argv[2]))
expected_path = sys.argv[3]
bad = False

def check(label, ok, detail=""):
    global bad
    print(f"  {'ok     ' if ok else 'FAIL   '} {label}{'' if ok else '  ' + detail}")
    if not ok:
        bad = True

# product.json's own branding is checked by verify-server-tree.py, which runs on
# both sides of the pivot. What is left here needs the branding directory, so it
# can only run at build time.
check("manifest.json is branded", manifest.get("name") == "VSCodroid",
      f"name = {manifest.get('name')!r}")

# Locks the key set. A VS Code bump that adds, drops or renames a product.json
# key has to be looked at deliberately — silently inheriting one is how a CDN
# URL or a telemetry endpoint slips back in.
keys = sorted(product)
try:
    with open(expected_path) as f:
        want = [line.strip() for line in f if line.strip()]
except FileNotFoundError:
    print(f"  note    no {expected_path}; writing it from this build")
    with open(expected_path, "w") as f:
        f.write("\n".join(keys) + "\n")
    want = keys

added = [k for k in keys if k not in want]
dropped = [k for k in want if k not in keys]
check("product.json key set unchanged", not added and not dropped,
      f"added={added} dropped={dropped}")

sys.exit(1 if bad else 0)
PY
fi

echo
echo "  output  : $OUT"
du -sh "$OUT" | awk '{print "  size    : "$1}'
df -h "$WORK" | tail -1 | awk '{print "  disk free after: "$4}'

[ "$fail" -eq 0 ] || { echo; echo "VERIFY FAILED"; exit 1; }

step "Package"
# Packed here rather than in the workflow so a local build and a CI build produce
# the same file. The contents are stored without a leading directory, so the
# fetcher extracts straight into whatever name the app expects.
TARBALL="$WORK/vscode-reh-web-linux-$ARCH-$VSCODE_VERSION.tar.gz"
t0=$SECONDS
tar -C "$OUT" -czf "$TARBALL" .
elapsed $(( SECONDS - t0 ))
echo "  tarball : $TARBALL"
du -h "$TARBALL" | awk '{print "  size    : "$1}'
echo
echo "=== Code - OSS reh-web build complete ==="
