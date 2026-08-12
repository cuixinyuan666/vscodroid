#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "  VSCodroid Full Build"
echo "========================================="
echo ""

# Step 1: Setup
echo "[1/4] Running setup..."
"$SCRIPT_DIR/setup.sh"

# Step 2: Fetch the VS Code Server
echo ""
echo "[2/4] Fetching VS Code Server..."
"$SCRIPT_DIR/download-vscode-server.sh"

# Step 3: Package assets
echo ""
echo "[3/4] Packaging assets..."
"$SCRIPT_DIR/package-assets.sh"

# Step 4: Build Android APK
echo ""
echo "[4/4] Building Android APK..."
cd "$ROOT_DIR/android"
if [ -f "gradlew" ]; then
    ./gradlew assembleDebug
    echo "  ✓ APK built"
else
    echo "  ⚠ Gradle wrapper not found. Run: cd android && gradle wrapper"
fi

# Summary
echo ""
echo "Build Summary"
APK_PATH="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
    echo "  ✓ APK: $(du -sh "$APK_PATH" | cut -f1) at $APK_PATH"
else
    echo "  ⚠ APK not found"
fi

echo ""
echo "========================================="
echo "  Build complete!"
echo "  Deploy: ./scripts/deploy.sh"
echo "========================================="
