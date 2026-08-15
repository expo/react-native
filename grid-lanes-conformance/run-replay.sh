#!/bin/bash
# Build and run the conformance replay against Yoga directly.
#
# Yoga has no standalone build in this tree that is quicker than just handing
# clang the sources — there are few enough of them, and building them here
# means the harness always tests the working copy rather than whatever a stale
# CMake cache happened to keep.
#
# Usage: ./run-replay.sh [args passed to the replay binary]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YOGA="$ROOT/../packages/react-native/ReactCommon/yoga"
BIN="$ROOT/.replay"

node "$ROOT/gen-fixtures.js" > "$ROOT/fixtures.h"

clang++ -std=c++20 -O1 -g \
  -I"$YOGA" -I"$ROOT" \
  "$ROOT/replay.cpp" \
  $(find "$YOGA/yoga" -name '*.cpp') \
  -o "$BIN"

"$BIN" "$@"
