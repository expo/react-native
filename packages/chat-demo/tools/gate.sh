#!/bin/bash
#
# The whole gate for chat-demo: jest, a fresh build, and the UI suite.
#
# Read the OUTPUT, not the exit code. `xcodebuild test` exits 0 on runs where
# cases never executed, and a truncated run looks green; so this asserts on the
# things that actually go wrong:
#
#   - the installed app is the one just built (a JS-only edit is invisible to
#     `xcodebuild test`, which will happily re-measure the old bundle)
#   - no `TEST EXECUTE FAILED`
#   - no `Failing tests:`
#   - the number of DISTINCT cases that ran matches EXPECTED_CASES
#
# The last one is the important one: a suite that dies a third of the way in
# still prints a cheerful summary line for the part that ran.
set -uo pipefail
cd "$(dirname "$0")/.."
DEMO=$PWD
# The simulators, whichever are booted — a hardcoded identifier outlives the
# device it named, and this one did: the gate failed on "install" against a
# simulator that had been deleted months before.
BOOTED=$(xcrun simctl list devices booted | grep -oE "[0-9A-F-]{36}")
SIM=${SIM:-$(echo "$BOOTED" | sed -n 1p)}
[ -n "$SIM" ] || { echo "GATE FAILED: no simulator is booted"; exit 1; }
# The second simulator. The suite is dealt across the two and both run at once,
# which is where the wall clock went from twenty-one minutes to nine. Set it
# empty to run everything on SIM.
#
# Not `xcodebuild -parallel-testing-enabled`: that clones simulators, and four
# clones on a sixteen-gigabyte machine thrash. These two are already booted.
SIM2=${SIM2:-$(echo "$BOOTED" | sed -n 2p)}
# SendDrive, ReactionShot and TreeDump drive the app for recordings and dumps
# rather than asserting anything, and cost three and a half minutes. Ask for
# them when you want the footage.
RECORDERS=${GATE_RECORDERS:-0}
DD=${DD:-/tmp/chatdemo-rel}
if [ "$RECORDERS" = "1" ]; then EXPECTED_CASES=${EXPECTED_CASES:-69}; else EXPECTED_CASES=${EXPECTED_CASES:-59}; fi
APP=$DD/Build/Products/Release-iphonesimulator/ChatDemo.app
LOG=${LOG:-/tmp/chatdemo-gate.log}
LOG_B=${LOG%.log}-b.log
TRACE=${TRACE:-/tmp/chatdemo-gate-trace.log}
TRACE_B=${TRACE%.log}-b.log
fail() { echo "GATE FAILED: $*"; exit 1; }

echo "=== jest ==="
( cd "$DEMO/../.." && yarn jest packages/chat-demo 2>&1 ) | tee /tmp/chatdemo-jest.log | tail -4
grep -qE "Tests:.*failed" /tmp/chatdemo-jest.log && fail "jest had failures"

echo "=== build ==="
# The EXIT STATUS, not a grep for "error:".
#
# Piping xcodebuild into grep throws its status away, and a FAILED build then
# looks identical to a clean one: the previous .app is still sitting in the
# derived-data path, `simctl install` happily reinstalls it, and the suite runs
# against a STALE BINARY. The bundle check below does not catch it either — it
# compares `main.jsbundle`, which is unchanged when the break is native. This
# gate reported GATE GREEN exactly once that way, on a tree that did not compile.
( cd "$DEMO/ios" && xcodebuild -workspace ChatDemo.xcworkspace -scheme ChatDemo \
    -configuration Release -sdk iphonesimulator -derivedDataPath "$DD" -quiet build ) \
    > /tmp/chatdemo-build.log 2>&1
BUILD_RC=$?
grep -E "error:" /tmp/chatdemo-build.log | head -5
[ "$BUILD_RC" = "0" ] || fail "xcodebuild exited $BUILD_RC — the app was NOT rebuilt"
[ -d "$APP" ] || fail "no app at $APP"
# And each kind of source must be older than the artefact it actually lands in.
#
# NATIVE code lands in the executable; JS lands in `main.jsbundle`. Comparing a
# .js file against the executable is a FALSE ALARM — a JS-only edit never relinks
# the binary, so the check failed on every JS change and said the tree was stale
# when it was not. It cost a full gate run before it was noticed.
STALE=""
for f in $(find "$DEMO/../react-native/React" -name '*.mm' -o -name '*.m' -o -name '*.h' 2>/dev/null); do
  [ "$f" -nt "$APP/ChatDemo" ] && STALE="$STALE $f"
done
for f in $(find "$DEMO" -name '*.js' 2>/dev/null | grep -v node_modules); do
  [ "$f" -nt "$APP/main.jsbundle" ] && STALE="$STALE $f"
done
[ -z "$STALE" ] || fail "sources newer than what they build into:$(echo $STALE | cut -c1-200)"

echo "=== install, and prove it is the app we just built ==="
BUILT=$(shasum -a 256 "$APP/main.jsbundle" 2>/dev/null | cut -c1-16)
[ -n "$BUILT" ] || fail "no bundle in the app that was just built"
SIMS="$SIM"
[ -n "$SIM2" ] && SIMS="$SIM $SIM2"
for S in $SIMS; do
  xcrun simctl bootstatus "$S" -b > /dev/null 2>&1
  xcrun simctl terminate "$S" dev.expo.frontierdemo 2>/dev/null
  xcrun simctl install "$S" "$APP" || fail "install on $S"
  CONTAINER=$(xcrun simctl get_app_container "$S" dev.expo.frontierdemo 2>/dev/null)
  LIVE=$(shasum -a 256 "$CONTAINER/main.jsbundle" 2>/dev/null | cut -c1-16)
  echo "built=$BUILT installed=$LIVE on $S"
  [ "$BUILT" = "$LIVE" ] || fail "the bundle installed on $S is not the built bundle"
done

# Every case class in the suite, discovered rather than listed: a class added to
# a new file and never named here would otherwise run in neither lane, and the
# case count is what would have to notice.
CLASSES=$(grep -h "^final class" "$DEMO"/ios/uitests/Sources/*.swift | sed 's/final class //; s/:.*//' | sort)
if [ "$RECORDERS" != "1" ]; then
  CLASSES=$(echo "$CLASSES" | grep -vE "^(SendDrive|ReactionShot|TreeDump)$")
fi
# Dealt alternately, by name. A weight table would balance the two lanes better
# and would be wrong the first time a case got slower; this is within a minute
# of even across thirty classes and needs no maintenance.
LANE_A=""; LANE_B=""; N=0
for C in $CLASSES; do
  if [ $((N % 2)) -eq 0 ]; then LANE_A="$LANE_A $C"; else LANE_B="$LANE_B $C"; fi
  N=$((N + 1))
done
[ -n "$SIM2" ] || { LANE_A="$LANE_A $LANE_B"; LANE_B=""; }
echo "lane A:$LANE_A"
[ -n "$LANE_B" ] && echo "lane B:$LANE_B"

echo "=== UI suite ==="
# The UI tests are their OWN project, not a target in the app workspace — the
# workspace has no such scheme and `xcodebuild` fails with a message that scrolls
# past in a long log. That failure is what "ran 0 cases" caught the first time.
#
# Built once, then run without building: two lanes building the same runner into
# the same derived data at the same time is a race for no gain.
# With no destination xcodebuild builds the scheme for MY MAC, which fails on a
# deployment target it never had to meet.
#
# Generated first: the project lists every source FILE, so a case added since the
# last generate compiles into nothing and the suite simply runs one case fewer.
( cd "$DEMO/ios/uitests" && "${XCODEGEN:-/opt/homebrew/bin/xcodegen}" generate >/dev/null ) \
  || fail "xcodegen failed"
( cd "$DEMO/ios" && xcodebuild build-for-testing -project uitests/ChatDemoUITests.xcodeproj \
    -scheme ChatDemoUITests -configuration Release -derivedDataPath "$DD" \
    -destination "generic/platform=iOS Simulator" -quiet ) \
    > /tmp/chatdemo-testbuild.log 2>&1 || { tail -5 /tmp/chatdemo-testbuild.log; fail "the test runner did not build"; }

# The app's own trace, captured for the length of the suite. The cases assert
# what they can see; this is for the invariants they cannot — a scroll view that
# is told nothing looks exactly like one that was told the right thing.
#
# Streamed from INSIDE each simulator, so a lane's trace holds one app's lines:
# `/usr/bin/log stream` on the host carries every simulator's, and the
# assertions below read sequences, which two interleaved runs would invent.
# `--level info`: the app echoes at info level so the store never keeps it.
lane() {
  local sim=$1 classes=$2 log=$3 trace=$4 bundle=$5
  local args=()
  local c
  for c in $classes; do args+=(-only-testing:ChatDemoUITests/$c); done
  rm -rf "$bundle"
  xcrun simctl spawn "$sim" log stream --level info \
      --predicate 'subsystem == "dev.expo.keyboard"' --style compact > "$trace" 2>&1 &
  local tracer=$!
  ( cd "$DEMO/ios" && xcodebuild test-without-building -project uitests/ChatDemoUITests.xcodeproj \
      -scheme ChatDemoUITests -configuration Release -derivedDataPath "$DD" \
      -resultBundlePath "$bundle" -destination "id=$sim" "${args[@]}" ) > "$log" 2>&1
  kill "$tracer" 2>/dev/null
}
lane "$SIM" "$LANE_A" "$LOG" "$TRACE" /tmp/chatdemo-gate-a.xcresult &
LANE_A_PID=$!
LANE_B_PID=""
if [ -n "$LANE_B" ]; then
  lane "$SIM2" "$LANE_B" "$LOG_B" "$TRACE_B" /tmp/chatdemo-gate-b.xcresult &
  LANE_B_PID=$!
fi
wait $LANE_A_PID $LANE_B_PID 2>/dev/null
LOGS="$LOG"; TRACES="$TRACE"
[ -n "$LANE_B" ] && { LOGS="$LOG $LOG_B"; TRACES="$TRACE $TRACE_B"; }

EXEC_FAILED=$(cat $LOGS | grep -c "TEST EXECUTE FAILED")
# The class is module-qualified — `ChatDemoUITests.AnchorCheck` — so the
# character class has to admit the dot. Without it this matched nothing and the
# gate reported "ran 0 cases" for a suite that was passing.
UNIQUE=$(cat $LOGS | grep -oE "Test Case '-\[[A-Za-z.]+ [A-Za-z0-9_]+\]' (passed|failed)" | sort -u | wc -l | tr -d ' ')
echo "EXECUTE_FAILED: $EXEC_FAILED"
cat $LOGS | grep -E "^\s+Executed [0-9]+ tests" | tail -2
echo "unique cases: $UNIQUE (expected $EXPECTED_CASES)"
[ "$EXEC_FAILED" = "0" ] || fail "TEST EXECUTE FAILED x$EXEC_FAILED"
cat $LOGS | grep -q "^Failing tests:" && { cat $LOGS | grep -A20 "^Failing tests:" | head -22; fail "failing tests"; }
[ "$UNIQUE" = "$EXPECTED_CASES" ] || fail "ran $UNIQUE distinct cases, expected $EXPECTED_CASES"

# Every hosted bar must reach its screen's transcript. The sampler publishes on
# CHANGE, and a scroll view that registers while the obstruction happens to be
# what it already was hears nothing — its bottom inset stays at the safe area
# and the newest message sits under the composer. Measured in one run at ten
# of ninety hostings, every one under a green suite: the cases read positions
# that are wrong in the same way twice. Half a second is generous; a told
# scroll view reports within twenty-five milliseconds.
#
# Per lane, and summed: each trace is one simulator's, and a sequence read
# across two of them means nothing.
STUCK=0
for T in $TRACES; do
  N=$(awk '
  function ts(l) { match(l, /[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+/); s=substr(l,RSTART,RLENGTH); split(s,p,":"); return p[1]*3600+p[2]*60+p[3] }
  /accessory#[0-9]+ hosted in/ { hosted=ts($0); pending=1; next }
  pending && /insets top=.*kbInset=/ {
    match($0,/kbInset=[0-9.]+/); v=substr($0,RSTART+8,RLENGTH-8)+0; t=ts($0)-hosted
    if (v>0) pending=0
    else if (t>0.5) { n++; pending=0 } }
  END { print n+0 }' "$T")
  STUCK=$((STUCK + N))
done
echo "hostings whose transcript was never told: $STUCK"
[ "$STUCK" = "0" ] || fail "$STUCK hosted bar(s) never reached the transcript's inset (see $TRACES)"

# A screen pushed over one whose keyboard is up must not read that keyboard.
# The push has a signature: UIKit resigns the outgoing bar's field as it pins
# the input views (`editing ENDED … in accessory#A`), and within the transition
# another bar is hosted on another screen (`accessory#B hosted … screen#S`).
# For the next 0.6 s, screen#S's own keyboard height must be the safe area
# alone unless its own bar docks — a larger reading is the outgoing keyboard,
# which a window-wide sampler leaked (measured on a phone as the chat
# reserving 391 for main's keyboard, then sliding down as it left).
# Scoped to push-ins on purpose: a screen REVEALED by a held back-swipe sits
# under the popped screen's pinned keys and its guide rightly says so, and a
# screen with a field outside its bar owns a keyboard its bar never docks to.
# Two broader versions of this check fired on correct builds. This one was
# validated silent on a green run, and non-vacuous: it must see pushes.
LEAKED=0; PUSHES=0
for T in $TRACES; do
  read L P < <(awk '
  function ts(l){ match(l,/[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+/); s=substr(l,RSTART,RLENGTH); split(s,p,":"); return p[1]*3600+p[2]*60+p[3] }
  /editing ENDED .* in accessory#[0-9]+/ { ended=ts($0) }
  /accessory#[0-9]+ hosted in .* screen#[0-9]+/ { match($0,/screen#[0-9]+/); s=substr($0,RSTART,RLENGTH); match($0,/accessory#[0-9]+/); b=substr($0,RSTART,RLENGTH); bar[s]=b
    if (ended && ts($0)-ended < 0.6) { watch[s]=ts($0); docked[s]=(/docked to keyboard/); pushes++ } }
  /accessory#[0-9]+ bottom=keyboard/ { match($0,/accessory#[0-9]+/); b=substr($0,RSTART,RLENGTH); for (s in bar) if (bar[s]==b) docked[s]=1 }
  /kb h=.*screen#[0-9]+/ { match($0,/screen#[0-9]+/); s=substr($0,RSTART,RLENGTH); if (!(s in watch)) next
    if (ts($0)-watch[s] > 0.6) { delete watch[s]; next }
    match($0,/kb h=[0-9.]+/); h=substr($0,RSTART+5,RLENGTH-5)+0; if (!docked[s] && h>35) leaks++ }
  END { print leaks+0, pushes+0 }' "$T")
  LEAKED=$((LEAKED + L)); PUSHES=$((PUSHES + P))
done
echo "push-ins examined: $PUSHES; incoming screens that read the outgoing keyboard: $LEAKED"
[ "$PUSHES" != "0" ] || fail "the push-in check saw no pushes — the trace signature changed, or the suite stopped covering it"
[ "$LEAKED" = "0" ] || fail "$LEAKED reading(s) of the outgoing screen's keyboard on a screen just pushed over it (see $TRACES)"
echo "GATE GREEN"
