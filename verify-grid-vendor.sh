#!/bin/bash
# Verify the vendored CSS Grid layout algorithm (Yoga PR #1894).
#
# Builds yogacore with the vendored algorithm/grid/ directory in it, lays out a
# grid through the public Yoga API, and compares every coordinate against
# numbers read out of real Safari for the identical CSS.
#
# The Safari side is `grid-vendor-verify.html`. To re-derive the ground truth
# rather than trusting the constants baked into grid-vendor-verify.cpp:
#
#   python3 -m http.server 8799 --directory . &
#   safaridriver -p 4455 &
#   # create a session, navigate to http://localhost:8799/grid-vendor-verify.html,
#   # then evaluate `return JSON.stringify(window.__rects)`
#
# See packages/react-native/ReactCommon/yoga/yoga/algorithm/grid/README-VENDORED.md
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YOGA="$ROOT/packages/react-native/ReactCommon/yoga"
BUILD="${TMPDIR:-/tmp}/yoga-grid-vendor-build"

echo "==> configuring yogacore"
cmake -S "$YOGA/yoga" -B "$BUILD" -DCMAKE_BUILD_TYPE=Debug > "$BUILD.cmake.log" 2>&1 ||
  { echo "cmake failed; see $BUILD.cmake.log"; exit 1; }

echo "==> building yogacore (with vendored algorithm/grid/)"
cmake --build "$BUILD" -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" > "$BUILD.build.log" 2>&1 ||
  { echo "build failed; see $BUILD.build.log"; exit 1; }

echo "==> building the verifier"
c++ -std=c++20 -I"$YOGA" "$ROOT/grid-vendor-verify.cpp" "$BUILD/libyogacore.a" \
  -o "$BUILD/grid-vendor-verify"

echo "==> laying out the grid and comparing against Safari"
exec "$BUILD/grid-vendor-verify"
