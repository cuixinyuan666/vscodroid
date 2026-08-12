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
#       -v "$PWD/branding:/branding" \
#       -v "$PWD/patches:/patches:ro" \
#       vscodroid-codeoss-build:20.18.0 bash /build.sh
#
# Patches and branding are both applied to the source before gulp runs, so their
# effects are baked in wherever the build inlines them rather than only where a
# later regex reaches. Each stage prints what it did and fails the build if it
# could not, so a broken build is attributable to a stage rather than discovered
# on a device.

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
    git -C "$SRC" reset -q 2>/dev/null || true
    git -C "$SRC" checkout -- src/ 2>/dev/null || true
    git -C "$SRC" clean -fdq src/ 2>/dev/null || true
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

# Applying a patch to the source proves nothing about the package: the file may
# not be in this target's graph, or the build may inline an older copy. Each
# patch therefore leaves a fingerprint that has to survive minification, and the
# packaged output is searched for it.
if [ -d "$PATCHES" ] && [ -n "$(ls -A "$PATCHES"/*.patch 2>/dev/null)" ]; then
    # patch | bundle it must reach | fingerprint that survives minification
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

check("product.json is branded", product.get("nameLong") == "VSCodroid",
      f"nameLong = {product.get('nameLong')!r}")
check("no vscode-cdn.net template", "webviewContentExternalBaseUrlTemplate" not in product)
check("gallery points at Open VSX",
      "open-vsx.org" in product.get("extensionsGallery", {}).get("serviceUrl", ""))
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
echo
echo "=== Code - OSS reh-web build complete ==="
