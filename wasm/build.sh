#!/usr/bin/env bash
# Build PlutoBook as a WebAssembly module using Emscripten.
#
# Prerequisites:
#   - Emscripten SDK installed and EMSDK env variable set, OR emsdk_env.sh
#     already sourced so that emcc/em++ are on PATH.
#   - Meson and Ninja installed.
#
# Usage:
#   ./wasm/build.sh          # release build (default: -Oz, LTO, closure)
#   ./wasm/build.sh --debug  # debug build (faster compile, larger output)
#
# Output: dist/plutobook.js  dist/plutobook.wasm

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${PROJECT_ROOT}/builddir-wasm"
DIST_DIR="${PROJECT_ROOT}/dist"
BUILD_TYPE="release"

# Parse arguments.
for arg in "$@"; do
  case "$arg" in
    --debug) BUILD_TYPE="debugoptimized" ;;
  esac
done

# Activate Emscripten if EMSDK is set and emcc is not already on PATH.
if ! command -v emcc &>/dev/null; then
  if [[ -n "${EMSDK:-}" ]]; then
    # shellcheck disable=SC1090
    source "${EMSDK}/emsdk_env.sh"
  else
    echo "Error: emcc not found. Install Emscripten and set EMSDK or source emsdk_env.sh first." >&2
    exit 1
  fi
fi

echo "Using emcc: $(command -v emcc)"
emcc --version | head -1

# Configure.
meson setup "${BUILD_DIR}" \
  --cross-file "${PROJECT_ROOT}/cross/emscripten.ini" \
  --native-file "${PROJECT_ROOT}/cross/native.ini" \
  --buildtype="${BUILD_TYPE}" \
  --default-library=static \
  -Dcurl=disabled \
  -Dturbojpeg=disabled \
  -Dwebp=disabled \
  -Dtools=disabled \
  -Dexamples=disabled \
  --wipe 2>/dev/null || \
meson setup "${BUILD_DIR}" \
  --cross-file "${PROJECT_ROOT}/cross/emscripten.ini" \
  --native-file "${PROJECT_ROOT}/cross/native.ini" \
  --buildtype="${BUILD_TYPE}" \
  --default-library=static \
  -Dcurl=disabled \
  -Dturbojpeg=disabled \
  -Dwebp=disabled \
  -Dtools=disabled \
  -Dexamples=disabled

# Build.
meson compile -C "${BUILD_DIR}"

# Copy artefacts.
mkdir -p "${DIST_DIR}"
cp "${BUILD_DIR}/wasm/plutobook.js"   "${DIST_DIR}/"
cp "${BUILD_DIR}/wasm/plutobook.wasm" "${DIST_DIR}/"

echo ""
echo "Build complete."
echo "  JS:   ${DIST_DIR}/plutobook.js"
echo "  WASM: ${DIST_DIR}/plutobook.wasm"
wasm_size=$(wc -c < "${DIST_DIR}/plutobook.wasm")
echo "  WASM size: ${wasm_size} bytes ($(( wasm_size / 1024 )) KB)"
