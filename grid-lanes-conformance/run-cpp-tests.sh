#!/bin/bash
# Build and run the hand-derived C++ tests — the parts of the spec the Safari
# oracle cannot adjudicate, so they cannot live in the corpus.
#
# Usage: ./run-cpp-tests.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YOGA="$ROOT/../packages/react-native/ReactCommon/yoga"

status=0
for test in percentage-tolerance-test stacking-alignment-test; do
  echo "== $test"
  clang++ -std=c++20 -O1 -g \
    -I"$YOGA" \
    "$ROOT/$test.cpp" \
    $(find "$YOGA/yoga" -name '*.cpp') \
    -o "$ROOT/.$test"
  "$ROOT/.$test" || status=1
  echo
done
exit $status
