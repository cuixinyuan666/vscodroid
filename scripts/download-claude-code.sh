#!/usr/bin/env bash
set -euo pipefail

# Bundles the Claude Code CLI and its VS Code extension.
#
#   ./scripts/download-claude-code.sh
#
# Two pieces that have to agree, and one substitution that makes them work on
# Android at all.
#
# The CLI is pinned to the last release that ships as JavaScript. From 2.1.113
# it is distributed as a per-platform native binary instead, and there is no
# Android build: the linux-arm64 one wants glibc and the musl one wants
# /lib/ld-musl-aarch64.so.1, neither of which Bionic provides. 2.1.112 is plain
# JS needing only Node >= 18, and it runs on the bundled Node 20.18.1 — measured
# on an arm64 Android 16 device, not assumed.
#
# The extension resolves the CLI in resolveClaudeBinary(): the setting
# claudeCode.claudeProcessWrapper, when set, becomes the executable and the
# bundled binary path becomes its first argument. There is no PATH fallback. So
# resources/native-binary/claude is replaced with the CLI's cli.js, and the
# wrapper setting points at the node symlink — the extension then launches
# `node .../resources/native-binary/claude`, which is exactly what we want. That
# substitution also drops 288 MB of unusable musl binary from the extension.
#
# vendor/ is dropped from the CLI for the same reason: its ripgrep and
# audio-capture builds target other platforms. USE_BUILTIN_RIPGREP=0 sends it to
# the ripgrep already bundled as libripgrep.so.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$ROOT_DIR/android/app/src/main/assets/extensions"
WORK_DIR="$ROOT_DIR/toolchains/claude-code"

# Last release with `bin: {claude: "cli.js"}`; 2.1.113 switched to a native
# binary. Re-check with:
#   npm view @anthropic-ai/claude-code@<version> bin engines
CLI_VERSION="${CLAUDE_CLI_VERSION:-2.1.112}"
EXT_VERSION="${CLAUDE_EXT_VERSION:-2.1.228}"

EXT_DIR="$ASSETS_DIR/Anthropic.claude-code-$EXT_VERSION"

echo "=== Claude Code ==="
echo "  CLI       : $CLI_VERSION (JavaScript)"
echo "  extension : $EXT_VERSION"

mkdir -p "$WORK_DIR" "$ASSETS_DIR"

# --- CLI ---------------------------------------------------------------------
CLI_TGZ="$WORK_DIR/claude-code-$CLI_VERSION.tgz"
if [ ! -f "$CLI_TGZ" ]; then
    echo ""
    echo "--- Downloading CLI ---"
    url="https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-$CLI_VERSION.tgz"
    curl -sL --fail --show-error -o "$CLI_TGZ" "$url"
fi
echo "  tarball   : $(du -h "$CLI_TGZ" | cut -f1)"

CLI_SRC="$WORK_DIR/cli-$CLI_VERSION"
rm -rf "$CLI_SRC"
mkdir -p "$CLI_SRC"
tar xzf "$CLI_TGZ" -C "$CLI_SRC" --strip-components=1

# Refuse a version that is not the JavaScript kind, rather than shipping a
# binary that cannot load and finding out on a device.
cli_bin=$(python3 -c "import json;print(json.load(open('$CLI_SRC/package.json'))['bin']['claude'])")
if [ "$cli_bin" != "cli.js" ]; then
    echo "  ERROR: $CLI_VERSION ships bin=$cli_bin, not cli.js." >&2
    echo "         Releases from 2.1.113 are per-platform native binaries with no" >&2
    echo "         Android build. Keep the pin on the last JavaScript release." >&2
    exit 1
fi

before=$(du -sk "$CLI_SRC" | cut -f1)
rm -rf "$CLI_SRC/vendor" "$CLI_SRC/README.md" "$CLI_SRC/sdk-tools.d.ts"
after=$(du -sk "$CLI_SRC" | cut -f1)
echo "  pruned    : $((before / 1024)) MB -> $((after / 1024)) MB (vendor/ is other platforms)"

# --- Extension ---------------------------------------------------------------
EXT_VSIX="$WORK_DIR/claude-code-$EXT_VERSION.vsix"
if [ ! -f "$EXT_VSIX" ]; then
    echo ""
    echo "--- Downloading extension ---"
    api="https://open-vsx.org/api/Anthropic/claude-code/$EXT_VERSION"
    url=$(curl -sL --fail --show-error "$api" \
        | python3 -c "import json,sys;print(json.load(sys.stdin)['files']['download'])")
    curl -sL --fail --show-error -o "$EXT_VSIX" "$url"
fi
echo "  vsix      : $(du -h "$EXT_VSIX" | cut -f1)"

EXT_TMP="$WORK_DIR/ext-$EXT_VERSION"
rm -rf "$EXT_TMP" "$EXT_DIR"
mkdir -p "$EXT_TMP"
unzip -q -o "$EXT_VSIX" "extension/*" -d "$EXT_TMP"
mkdir -p "$EXT_DIR"
cp -a "$EXT_TMP/extension/." "$EXT_DIR/"
rm -rf "$EXT_TMP"

before=$(du -sk "$EXT_DIR" | cut -f1)

# resolveClaudeBinary() looks here, so this is where the CLI has to be. The
# musl binary that was here is removed with the rest of resources/native-binaries.
NATIVE_SLOT="$EXT_DIR/resources/native-binary"
rm -rf "$NATIVE_SLOT" "$EXT_DIR/resources/native-binaries" "$EXT_DIR/resources/audio-capture"
mkdir -p "$NATIVE_SLOT"
cp "$CLI_SRC/cli.js" "$NATIVE_SLOT/claude"
cp "$CLI_SRC/package.json" "$NATIVE_SLOT/package.json"
cp "$CLI_SRC/LICENSE.md" "$NATIVE_SLOT/LICENSE.md" 2>/dev/null || true

after=$(du -sk "$EXT_DIR" | cut -f1)
echo "  extension : $((before / 1024)) MB -> $((after / 1024)) MB"

# Gradle's AAPT drops assets whose names start with a dot.
while IFS= read -r dotfile; do
    base=$(basename "$dotfile")
    mv "$dotfile" "$(dirname "$dotfile")/_${base#.}"
    echo "  renamed   : $base -> _${base#.}"
done < <(find "$EXT_DIR" -name '.*' -not -name '.' -not -name '..')

python3 "$SCRIPT_DIR/check-extension.py" "$EXT_DIR" "$ROOT_DIR/VSCODE_VERSION"

# The substitution is the whole integration, so it is checked rather than assumed.
if grep -qm1 "Claude Code" "$NATIVE_SLOT/claude"; then
    echo "  ok     resources/native-binary/claude is the JavaScript CLI"
else
    echo "  FAIL   resources/native-binary/claude is not the CLI we put there" >&2
    exit 1
fi

# cli.js is ESM and the file it becomes has no extension, so Node decides its
# module format from the nearest package.json. Without "type": "module" beside
# it, Node 20 refuses to load it — and the error surfaces as the extension's
# child exiting, not as anything this script did. Node 20.19 made module
# detection automatic, but the bundled runtime is 20.18.1, which does not.
slot_type=$(python3 -c "import json;print(json.load(open('$NATIVE_SLOT/package.json')).get('type'))" 2>/dev/null || echo "")
if [ "$slot_type" = "module" ]; then
    echo "  ok     the slot carries a package.json declaring type=module"
else
    echo "  FAIL   $NATIVE_SLOT/package.json must declare \"type\": \"module\"; got ${slot_type:-nothing}" >&2
    exit 1
fi

# Where the substituted file lands is decided by the fallback lookup, which is
# only reached because the per-platform directory is gone. A future extension
# version that reintroduces it would win, and its binary cannot run here.
if [ -e "$EXT_DIR/resources/native-binaries" ]; then
    echo "  FAIL   resources/native-binaries came back; the per-platform lookup would win" >&2
    exit 1
fi
echo "  ok     no per-platform binary directory to shadow the slot"

echo ""
echo "=== Claude Code ready ==="
echo "  $EXT_DIR"
echo ""
echo "  claudeCode.claudeProcessWrapper must point at the node symlink, and"
echo "  USE_BUILTIN_RIPGREP=0 must be in the environment; FirstRunSetup writes both."
