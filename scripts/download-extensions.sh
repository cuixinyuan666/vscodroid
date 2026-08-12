#!/usr/bin/env bash
set -euo pipefail

# Download pre-built extensions from Open VSX and extract them into
# android/app/src/main/assets/extensions/ for bundling in the APK.
#
# Each extension becomes a directory like PKief.material-icon-theme-5.17.0/
# which FirstRunSetup extracts on device and registers via extensions.json.
#
# Compatible with bash 3.2+ (macOS default).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$ROOT_DIR/android/app/src/main/assets/extensions"
WORK_DIR="$ROOT_DIR/toolchains/extensions"

# Extensions to bundle: publisher.name or publisher.name@version
#
# Every one is pinned to the newest STABLE version whose engines.vscode is
# satisfied by the VSCODE_VERSION file. Stable matters as much as compatible:
# GitLens publishes pre-release builds far more often than releases, so "newest
# compatible" lands on one — and its pre-releases carry an expiry date. Picking
# one ships an extension that works in testing and then puts an "this
# pre-release has expired" error in front of every user some weeks later. Leaving one unpinned would resolve to
# whatever is newest on the day of the build, and an extension needing a newer VS
# Code than the server does not error — it simply never activates, so the feature
# is missing with nothing in the log to explain it. The check after extraction
# below turns that into a failed build instead.
#
# Re-derive the pins after bumping VSCODE_VERSION; the comments say what is
# holding one back.
EXTENSIONS=(
    "PKief.material-icon-theme@5.37.0"
    "esbenp.prettier-vscode@11.0.3"     # 12.x needs ^1.101.0, which needs Node 22
    "ms-python.python@2026.4.0"
    "dbaeumer.vscode-eslint@3.0.34"
    "bradlc.vscode-tailwindcss@0.16.0"
    "eamodio.gitlens@17.11.1"           # newest STABLE for 1.96.4; 17.12+ needs ^1.101.0
)

OPENVSX_API="https://open-vsx.org/api"

echo "=== Downloading bundled extensions from Open VSX ==="

mkdir -p "$ASSETS_DIR"
mkdir -p "$WORK_DIR"

for EXT_SPEC in "${EXTENSIONS[@]}"; do
    # Parse publisher.name@version or publisher.name (latest)
    EXT_ID="${EXT_SPEC%%@*}"
    PINNED_VERSION="${EXT_SPEC#*@}"
    if [ "$PINNED_VERSION" = "$EXT_SPEC" ]; then
        PINNED_VERSION=""
    fi

    PUBLISHER="${EXT_ID%%.*}"
    NAME="${EXT_ID#*.}"

    echo ""
    echo "--- $PUBLISHER/$NAME${PINNED_VERSION:+ @$PINNED_VERSION} ---"

    # Query Open VSX API for version metadata
    if [ -n "$PINNED_VERSION" ]; then
        API_URL="$OPENVSX_API/$PUBLISHER/$NAME/$PINNED_VERSION"
        METADATA_FILE="$WORK_DIR/${EXT_ID}-${PINNED_VERSION}.json"
    else
        API_URL="$OPENVSX_API/$PUBLISHER/$NAME"
        METADATA_FILE="$WORK_DIR/${EXT_ID}.json"
    fi

    if [ ! -f "$METADATA_FILE" ]; then
        echo "  Fetching metadata..."
        curl -sL --fail --show-error \
            -H "Accept: application/json" \
            -o "$METADATA_FILE" \
            "$API_URL"
    fi

    # A pre-release build stops working on a date rather than on a version, so
    # it passes every check here and every test on device, then expires weeks
    # later in front of the user. Open VSX records which kind this is; the pin is
    # required to name a release.
    IS_PRERELEASE=$(python3 -c "import json; print(json.load(open('$METADATA_FILE')).get('preRelease'))")
    if [ "$IS_PRERELEASE" = "True" ]; then
        echo "  FAIL   $EXT_ID $PINNED_VERSION is a pre-release; pin a release instead." >&2
        echo "         Pre-releases expire on a date and take the feature with them." >&2
        exit 1
    fi

    # Extract version and download URL
    VERSION=$(python3 -c "import json; print(json.load(open('$METADATA_FILE'))['version'])")
    DOWNLOAD_URL=$(python3 -c "import json; d=json.load(open('$METADATA_FILE')); print(d['files']['download'])")

    DIR_NAME="${EXT_ID}-${VERSION}"
    DEST_DIR="$ASSETS_DIR/$DIR_NAME"

    echo "  Version: $VERSION"
    echo "  Download URL: $DOWNLOAD_URL"

    # Skip if already extracted
    if [ -d "$DEST_DIR" ] && [ -f "$DEST_DIR/package.json" ]; then
        echo "  Already extracted: $DIR_NAME (skipping)"
        continue
    fi

    # Download VSIX
    VSIX_FILE="$WORK_DIR/${DIR_NAME}.vsix"
    if [ ! -f "$VSIX_FILE" ]; then
        echo "  Downloading VSIX..."
        curl -sL --fail --show-error -o "$VSIX_FILE" "$DOWNLOAD_URL"
        echo "  Downloaded: $(du -sh "$VSIX_FILE" | cut -f1)"
    fi

    # Extract extension/ contents from VSIX (it's a ZIP)
    echo "  Extracting..."
    rm -rf "$DEST_DIR"
    mkdir -p "$DEST_DIR"

    # VSIX contains extension/ directory with actual extension files
    # Use -j to strip path prefix, but we need the directory structure
    TEMP_EXTRACT="$WORK_DIR/extract-${DIR_NAME}"
    rm -rf "$TEMP_EXTRACT"
    mkdir -p "$TEMP_EXTRACT"
    unzip -q -o "$VSIX_FILE" "extension/*" -d "$TEMP_EXTRACT"

    # Move extension/ contents to destination
    if [ -d "$TEMP_EXTRACT/extension" ]; then
        cp -a "$TEMP_EXTRACT/extension/." "$DEST_DIR/"
    else
        echo "  ERROR: No extension/ directory in VSIX"
        rm -rf "$DEST_DIR"
        continue
    fi
    rm -rf "$TEMP_EXTRACT"

    # Remove dotfiles that AAPT would strip from assets
    DOTFILES_FOUND=0
    while IFS= read -r dotfile; do
        DOTFILES_FOUND=1
        BASENAME=$(basename "$dotfile")
        DIRNAME=$(dirname "$dotfile")
        NEWNAME="${BASENAME#.}"
        echo "  Renaming dotfile: $BASENAME -> _${NEWNAME}"
        mv "$dotfile" "$DIRNAME/_${NEWNAME}"
    done < <(find "$DEST_DIR" -name '.*' -not -name '.' -not -name '..')

    if [ "$DOTFILES_FOUND" -eq 0 ]; then
        echo "  No dotfiles found (OK)"
    fi

    # An extension whose engines.vscode is newer than the server fails silently:
    # it is registered, never activates, and nothing is logged.
    python3 "$SCRIPT_DIR/check-extension.py" "$DEST_DIR" "$ROOT_DIR/VSCODE_VERSION"

    echo "  Extracted: $(du -sh "$DEST_DIR" | cut -f1) -> $DIR_NAME"
done

# Summary
echo ""
echo "=== Bundled extensions ready ==="
echo "Location: $ASSETS_DIR/"
for dir in "$ASSETS_DIR"/*/; do
    if [ -d "$dir" ]; then
        NAME=$(basename "$dir")
        SIZE=$(du -sh "$dir" | cut -f1)
        echo "  $NAME ($SIZE)"
    fi
done
echo ""
echo "Total: $(du -sh "$ASSETS_DIR" | cut -f1)"
