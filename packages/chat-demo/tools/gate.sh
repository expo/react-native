#!/bin/bash
#
# The chat-demo gate: jest, a Release build, and the UI suite on simulators.
#
# It reads the output instead of trusting exit codes, because `xcodebuild test`
# can exit 0 when cases never ran. It fails unless:
#
#   - the installed app's `main.jsbundle` matches the one just built
#   - there is no `TEST EXECUTE FAILED` and no `Failing tests:`
#   - the number of distinct test methods that ran equals EXPECTED_CASES
#   - the app-log checks at the end pass
#
# GATE_CLASSES="PanelCardCheck KeyboardGrowthCheck" runs only those classes: a
# targeted run for iteration. It builds and installs like the full gate but
# skips the case count and the whole-suite minimums, and ends with
# "TARGETED GREEN" rather than "GATE GREEN", so nothing publishes from it.
#
# GATE_SINCE=<ref> chooses the classes from what changed since <ref>, committed
# or not, through tools/gate-select.py (each class declares the app files it
# covers); GATE_SINCE=green means the commit the last full gate passed on. A
# change the selector cannot place runs everything, as a full gate.
#
# Every booted iPhone simulator is a lane (SIMS="<udid> <udid>" chooses). The
# classes go to the lanes longest first, by the durations the previous run
# wrote to $DURATIONS, so the lanes finish together. Not
# `-parallel-testing-enabled`: it clones simulators per run.
set -uo pipefail
cd "$(dirname "$0")/.."
DEMO=$PWD
BOOTED=$(xcrun simctl list devices booted | grep -oE "[0-9A-F-]{36}" | tr '\n' ' ')
SIMS=$(echo ${SIMS:-$BOOTED})
[ -n "$SIMS" ] || { echo "GATE FAILED: no simulator is booted"; exit 1; }
DURATIONS=${DURATIONS:-$HOME/.cache/chatdemo-gate/durations.txt}
LAST_GREEN=${LAST_GREEN:-$HOME/.cache/chatdemo-gate/last-green}
if [ -n "${GATE_SINCE:-}" ]; then
  SINCE=$GATE_SINCE
  if [ "$SINCE" = "green" ]; then
    [ -f "$LAST_GREEN" ] || { echo "GATE FAILED: no full gate has passed on this machine yet, so GATE_SINCE=green has no reference"; exit 1; }
    SINCE=$(cat "$LAST_GREEN")
  fi
  SELECTED=$(python3 tools/gate-select.py "$SINCE" 2>/tmp/chatdemo-select.log) || { cat /tmp/chatdemo-select.log; echo "GATE FAILED: the selector failed"; exit 1; }
  sed 's/^/select: /' /tmp/chatdemo-select.log
  if [ "$SELECTED" = "all" ]; then
    echo "select: everything, as a full gate"
  elif [ -z "$SELECTED" ]; then
    echo "select: nothing changed since $SINCE, so nothing to run"; echo "SELECTED GREEN"; exit 0
  else
    GATE_CLASSES=$(echo $SELECTED)
    echo "select: $GATE_CLASSES"
  fi
fi
TARGETED=0
[ -n "${GATE_CLASSES:-}" ] && TARGETED=1
# GATE_RECORDERS=1 also runs SendDrive, RevealShot and TreeDump.
# They record video and dump data but assert nothing, and add about 3.5 minutes.
# The same four names are excluded from CLASSES below.
RECORDERS=${GATE_RECORDERS:-0}
DD=${DD:-/tmp/chatdemo-rel}
# Distinct test methods that must run, with and without the recorders. Update
# both when adding or removing a UI test.
if [ "$RECORDERS" = "1" ]; then EXPECTED_CASES=${EXPECTED_CASES:-64}; else EXPECTED_CASES=${EXPECTED_CASES:-54}; fi
APP=$DD/Build/Products/Release-iphonesimulator/ChatDemo.app
# Lane 0 writes $LOG and $TRACE; lane N writes ${LOG%.log}-N.log and the same for the trace.
LOG=${LOG:-/tmp/chatdemo-gate.log}
TRACE=${TRACE:-/tmp/chatdemo-gate-trace.log}
fail() { echo "GATE FAILED: $*"; exit 1; }

echo "=== jest ==="
( cd "$DEMO/../.." && yarn jest packages/chat-demo 2>&1 ) | tee /tmp/chatdemo-jest.log | tail -4
grep -qE "Tests:.*failed" /tmp/chatdemo-jest.log && fail "jest had failures"

echo "=== build ==="
# Fail on xcodebuild's exit status. A failed build leaves the previous .app in
# $DD, which would otherwise be installed and tested.
( cd "$DEMO/ios" && xcodebuild -workspace ChatDemo.xcworkspace -scheme ChatDemo \
    -configuration Release -sdk iphonesimulator -derivedDataPath "$DD" -quiet build ) \
    > /tmp/chatdemo-build.log 2>&1
BUILD_RC=$?
grep -E "error:" /tmp/chatdemo-build.log | head -5
[ "$BUILD_RC" = "0" ] || fail "xcodebuild exited $BUILD_RC — the app was NOT rebuilt"
[ -d "$APP" ] || fail "no app at $APP"
# Fail if a source file is newer than the build output it goes into: React and
# ReactCommon native files against the executable, JS against `main.jsbundle`.
# This is the only stale-build check for native code; the hash check below
# covers only the bundle.
STALE=""
for f in $(find "$DEMO/../react-native/React" "$DEMO/../react-native/ReactCommon" \
    \( -name '*.mm' -o -name '*.m' -o -name '*.h' -o -name '*.cpp' \) 2>/dev/null); do
  [ "$f" -nt "$APP/ChatDemo" ] && STALE="$STALE $f"
done
for f in $(find "$DEMO" -name '*.js' 2>/dev/null | grep -v node_modules); do
  [ "$f" -nt "$APP/main.jsbundle" ] && STALE="$STALE $f"
done
[ -z "$STALE" ] || fail "sources newer than what they build into:$(echo $STALE | cut -c1-200)"

echo "=== install, and prove it is the app we just built ==="
BUILT=$(shasum -a 256 "$APP/main.jsbundle" 2>/dev/null | cut -c1-16)
[ -n "$BUILT" ] || fail "no bundle in the app that was just built"
for S in $SIMS; do
  xcrun simctl bootstatus "$S" -b > /dev/null 2>&1
  xcrun simctl terminate "$S" dev.expo.frontierdemo 2>/dev/null
  xcrun simctl install "$S" "$APP" || fail "install on $S"
  CONTAINER=$(xcrun simctl get_app_container "$S" dev.expo.frontierdemo 2>/dev/null)
  LIVE=$(shasum -a 256 "$CONTAINER/main.jsbundle" 2>/dev/null | cut -c1-16)
  echo "built=$BUILT installed=$LIVE on $S"
  [ "$BUILT" = "$LIVE" ] || fail "the bundle installed on $S is not the built bundle"
done

# Test classes are found by `^final class` in ios/uitests/Sources, so declare
# new ones that way.
CLASSES=$(grep -h "^final class" "$DEMO"/ios/uitests/Sources/*.swift | sed 's/final class //; s/:.*//' | sort)
if [ "$RECORDERS" != "1" ]; then
  CLASSES=$(echo "$CLASSES" | grep -vE "^(SendDrive|RevealShot|TreeDump)$")
fi
if [ "$TARGETED" = "1" ]; then
  for C in $GATE_CLASSES; do
    echo "$CLASSES" | grep -qx "$C" || fail "no test class named $C (GATE_CLASSES)"
  done
  CLASSES=$(echo $GATE_CLASSES | tr ' ' '\n')
  echo "targeted: $(echo $CLASSES)"
fi
# Longest first onto the least-loaded lane; a class the durations file has not
# seen counts as a minute.
LANE_SIMS=($SIMS)
LANE_COUNT=${#LANE_SIMS[@]}
LANE_CLASSES=(); LANE_LOAD=()
for ((i = 0; i < LANE_COUNT; i++)); do LANE_CLASSES[i]=""; LANE_LOAD[i]=0; done
ORDERED=$(for C in $CLASSES; do
  D=$( [ -f "$DURATIONS" ] && awk -v c="$C" '$1 == c { print int($2) }' "$DURATIONS" )
  echo "${D:-60} $C"
done | sort -rn)
while read -r D C; do
  [ -n "$C" ] || continue
  BEST=0
  for ((i = 1; i < LANE_COUNT; i++)); do
    [ "${LANE_LOAD[i]}" -lt "${LANE_LOAD[BEST]}" ] && BEST=$i
  done
  LANE_CLASSES[BEST]="${LANE_CLASSES[BEST]} $C"
  LANE_LOAD[BEST]=$(( LANE_LOAD[BEST] + D ))
done <<< "$ORDERED"
for ((i = 0; i < LANE_COUNT; i++)); do
  [ -n "${LANE_CLASSES[i]}" ] && echo "lane $i (${LANE_SIMS[i]}, ~${LANE_LOAD[i]}s):${LANE_CLASSES[i]}"
done

echo "=== UI suite ==="
# The UI tests are a separate XcodeGen project (ios/uitests), not a scheme in
# the app workspace. Regenerate it first: the project lists each source file, so
# a new file would not be compiled. Build once, then have both lanes use
# `test-without-building`, because two builds into the same $DD race.
# `-destination` is required, or xcodebuild builds for macOS and fails.
( cd "$DEMO/ios/uitests" && "${XCODEGEN:-/opt/homebrew/bin/xcodegen}" generate >/dev/null ) \
  || fail "xcodegen failed"
( cd "$DEMO/ios" && xcodebuild build-for-testing -project uitests/ChatDemoUITests.xcodeproj \
    -scheme ChatDemoUITests -configuration Release -derivedDataPath "$DD" \
    -destination "generic/platform=iOS Simulator" -quiet ) \
    > /tmp/chatdemo-testbuild.log 2>&1 || { tail -5 /tmp/chatdemo-testbuild.log; fail "the test runner did not build"; }

# Records the app's log for the length of the suite, for the checks at the end.
# It streams from inside each simulator (`simctl spawn … log stream`) because
# the host's `log stream` mixes all simulators, and the checks read sequences.
# `--level debug` because `console.log` lines arrive at debug level.
lane() {
  local sim=$1 classes=$2 log=$3 trace=$4 bundle=$5
  local args=()
  local c
  for c in $classes; do args+=(-only-testing:ChatDemoUITests/$c); done
  rm -rf "$bundle"
  # `dev.expo.keyboard` is `EXPKeyboardTrace`; `com.facebook.react.log` carries
  # `console.log` from screens/ChatScreen.js.
  xcrun simctl spawn "$sim" log stream --level debug \
      --predicate '(subsystem == "dev.expo.keyboard") OR (subsystem == "com.facebook.react.log")' \
      --style compact > "$trace" 2>&1 &
  local tracer=$!
  # The time allowance ends a test that XCUITest has stopped seeing as idle
  # (150 s is three of its 60 s waits; the longest honest test is under 50 s);
  # see the retry below.
  ( cd "$DEMO/ios" && xcodebuild test-without-building -project uitests/ChatDemoUITests.xcodeproj \
      -scheme ChatDemoUITests -configuration Release -derivedDataPath "$DD" \
      -resultBundlePath "$bundle" -destination "id=$sim" "${args[@]}" \
      -test-timeouts-enabled YES -default-test-execution-time-allowance 150 ) > "$log" 2>&1
  kill "$tracer" 2>/dev/null
}
LANE_PIDS=""; LOGS=""; TRACES=""
declare -a LANE_PID LANE_LOG
for ((i = 0; i < LANE_COUNT; i++)); do
  [ -n "${LANE_CLASSES[i]}" ] || continue
  if [ "$i" = "0" ]; then L=$LOG; T=$TRACE; else L=${LOG%.log}-$i.log; T=${TRACE%.log}-$i.log; fi
  lane "${LANE_SIMS[i]}" "${LANE_CLASSES[i]}" "$L" "$T" /tmp/chatdemo-gate-$i.xcresult &
  LANE_PID[i]=$!; LANE_LOG[i]=$L
  LANE_PIDS="$LANE_PIDS $!"
  LOGS="$LOGS $L"; TRACES="$TRACES $T"
done
# A watchdog, because a lane can stop dead: an app launch that never returns,
# or xcodebuild sitting on a finished suite. A lane whose log has not grown
# for four minutes (the longest step, a stalled test's allowance, is under
# three) is killed, and the classes it did not finish run again below.
UNFINISHED=""
while :; do
  ALIVE=0
  for ((i = 0; i < LANE_COUNT; i++)); do
    [ -n "${LANE_PID[i]:-}" ] || continue
    kill -0 "${LANE_PID[i]}" 2>/dev/null || continue
    ALIVE=1
    AGE=$(( $(date +%s) - $(stat -f %m "${LANE_LOG[i]}" 2>/dev/null || date +%s) ))
    if [ "$AGE" -gt 240 ]; then
      echo "lane $i has been silent for ${AGE}s; killing it"
      pkill -f "chatdemo-gate-$i.xcresult" 2>/dev/null
      for C in ${LANE_CLASSES[i]}; do
        grep -qE "Test Suite '$C' (passed|failed)" "${LANE_LOG[i]}" || UNFINISHED="$UNFINISHED $C"
      done
    fi
  done
  [ "$ALIVE" = "1" ] || break
  sleep 15
done
wait $LANE_PIDS 2>/dev/null

# A UIKit race, not the app: on a loaded machine the keyboard's window can be
# torn down before the springs of its dock's dismissal stop, and XCTest's
# in-app idle counter, a count of exactly those animation starts and stops,
# never returns to zero for the rest of that app session — every later step
# then waits its full minute, and the log says "App animations complete
# notification not received". (`EXP_KEYBOARD_TRACE_ANIMATIONS=1` shows the
# three animations.) The time allowance above ends such a test; here its class
# runs once more on a fresh app, and only a second failure counts: the first
# run's verdict lines for it are dropped from the lane logs before the checks.
STALL_MARK="App animations complete notification not received"
STALLED=""
for L in $LOGS; do
  grep -q "$STALL_MARK" "$L" || continue
  STALLED="$STALLED $(grep -oE "Test Case '-\[ChatDemoUITests\.[A-Za-z]+ [A-Za-z0-9_]+\]' failed" "$L" | sed -E "s/.*\.([A-Za-z]+) .*/\1/" | sort -u | tr '\n' ' ')"
done
STALLED=$(echo $STALLED $UNFINISHED | tr ' ' '\n' | sort -u | tr '\n' ' ')
STALLED=$(echo $STALLED)
if [ -n "$STALLED" ]; then
  echo "retrying once (an XCUITest idle stall, or a lane the watchdog killed):$STALLED"
  RETRY=${LOG%.log}-retry.log; RETRY_TRACE=${TRACE%.log}-retry.log
  lane "${LANE_SIMS[0]}" "$STALLED" "$RETRY" "$RETRY_TRACE" /tmp/chatdemo-gate-retry.xcresult
  LOGS="$LOGS $RETRY"; TRACES="$TRACES $RETRY_TRACE"
  for L in $LOGS; do
    [ "$L" = "$RETRY" ] && continue
    python3 - "$L" $STALLED <<'PY'
import re, sys
path, classes = sys.argv[1], sys.argv[2:]
lines = open(path, errors='replace').read().split('\n')
mention = re.compile(r'ChatDemoUITests\.(' + '|'.join(classes) + r')[ .]|^\s+(' + '|'.join(classes) + r')\.test')
kept = [l for l in lines if not mention.search(l)]
# A lane whose only failures were retried has no failures to report
if not any(re.search(r"Test Case .* failed \(", l) for l in kept):
    kept = [l for l in kept if 'TEST EXECUTE FAILED' not in l and not l.startswith('Failing tests:')]
open(path, 'w').write('\n'.join(kept))
PY
  done
fi

# Per-class durations for the next run's lane split: this run's classes replace
# their entries, the rest are kept.
mkdir -p "$(dirname "$DURATIONS")"
{ [ -f "$DURATIONS" ] && cat "$DURATIONS"; cat $LOGS | grep -oE "Test Case '-\[ChatDemoUITests\.[A-Za-z]+ [A-Za-z0-9_]+\]' (passed|failed) \([0-9.]+ seconds\)" \
    | sed -E "s/Test Case '-\[ChatDemoUITests\.([A-Za-z]+) [A-Za-z0-9_]+\]' (passed|failed) \(([0-9.]+) seconds\)/\1 \3/" \
    | awk '{ s[$1] += $2 } END { for (c in s) print c, s[c] }'; } \
  | awk '{ d[$1] = $2 } END { for (c in d) print c, d[c] }' | sort > "$DURATIONS.tmp" && mv "$DURATIONS.tmp" "$DURATIONS"

EXEC_FAILED=$(cat $LOGS | grep -c "TEST EXECUTE FAILED")
# Class names are module-qualified (`ChatDemoUITests.AnchorCheck`), so the
# pattern allows a dot.
UNIQUE=$(cat $LOGS | grep -oE "Test Case '-\[[A-Za-z.]+ [A-Za-z0-9_]+\]' (passed|failed)" | sort -u | wc -l | tr -d ' ')
echo "EXECUTE_FAILED: $EXEC_FAILED"
cat $LOGS | grep -E "^\s+Executed [0-9]+ tests" | tail -2
echo "unique cases: $UNIQUE (expected $EXPECTED_CASES)"
[ "$EXEC_FAILED" = "0" ] || fail "TEST EXECUTE FAILED x$EXEC_FAILED"
cat $LOGS | grep -q "^Failing tests:" && { cat $LOGS | grep -A20 "^Failing tests:" | head -22; fail "failing tests"; }
if [ "$TARGETED" = "1" ]; then
  [ "$UNIQUE" -gt 0 ] || fail "the targeted classes ran no cases"
else
  [ "$UNIQUE" = "$EXPECTED_CASES" ] || fail "ran $UNIQUE distinct cases, expected $EXPECTED_CASES"
fi

# The checks below match app log lines by their text. The lines come from
# `EXPKeyboardTrace` calls in packages/react-native
# (EXPScrollViewComponentView.mm, EXPKeyboardAccessoryComponentView.mm,
# EXPChatBubbleComponentView.mm, EXPTextInputCaret.mm,
# EXPElementTextAreaComponentView.mm) and from `console.log` in
# screens/ChatScreen.js. Changing a line's format there breaks its check here.
# Each lane's log is read separately and the counts are summed.
#
# After a keyboard accessory is hosted (`accessory#N hosted in`), an `insets`
# line still showing `kbInset=0` more than 0.5 s later fails: the transcript's
# scroll view was never given the accessory's height, so the newest message is
# hidden under the composer. A nonzero `kbInset` normally follows within 25 ms.
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

# Fails when an applied `topDelta=X` is followed, within the next six `offset`
# lines, by `d=-X` and then `d=+X` (within 0.6 pt): the scroll view adjusted for
# a top inset change and then scrolled back to stay at the bottom, which shows
# as a jump.
JUMPS=0
for T in $TRACES; do
  N=$(awk '
  /topDelta=/ { match($0,/topDelta=-?[0-9.]+/); d=substr($0,RSTART+9,RLENGTH-9)+0
    match($0,/applied=[01]/); a=substr($0,RSTART+8,1)+0
    if (a==1) { want=d; look=6 } else want=0
    next }
  want!=0 && /offset .* d=[-+][0-9.]+/ {
    match($0,/d=[-+][0-9.]+/); v=substr($0,RSTART+2,RLENGTH-2)+0
    if (back!=0) { if (v+back < 0.6 && v+back > -0.6) { n++; want=0; back=0; next } }
    else if (v+want < 0.6 && v+want > -0.6) { back=v }
    if (--look <= 0) { want=0; back=0 } }
  END { print n+0 }' "$T")
  JUMPS=$((JUMPS + N))
done
echo "offsets written twice in one pass: $JUMPS"

# `write … #N` is the Nth offset write within one mounting transaction. Two can
# be legitimate (for example, the composer's height settling moves the scroll
# end), so the limit is MAX_OFFSET_INTENTS (default 3), not 1. The worst line is
# printed to show which writes collided.
WORST=0
WORSTAT=""
for T in $TRACES; do
  N=$(grep -oE "write .* #[0-9]+ " "$T" | grep -oE "#[0-9]+" | tr -d '#' | sort -n | tail -1)
  [ -n "$N" ] && [ "$N" -gt "$WORST" ] && { WORST=$N; WORSTAT=$(grep -oE "write .* #$N .*" "$T" | tail -1); }
done
echo "most offset intents in one transaction: $WORST${WORSTAT:+  ($WORSTAT)}"
[ "$WORST" -le "${MAX_OFFSET_INTENTS:-3}" ] || fail "$WORST offset intents in one transaction, expected at most ${MAX_OFFSET_INTENTS:-3}"
[ "$JUMPS" = "0" ] || fail "$JUMPS top-inset correction(s) the bottom anchor then undid (see $TRACES)"

# `BounceCheck` scrolls a 100-row chat past its end. During each bounce
# (`offset` lines with `decel=1` and `past` over 0.5), a content size change
# (`state cs A -> B`) of less than 1 pt fails: it means a hidden row's
# placeholder height differs from its rendered height by rounding. On a device
# this can start a layout loop; see `-[EXPScrollViewInner holdOffsetWhile:]`.
# Larger changes, such as a receipt appearing, are allowed.
BOUNCES=0; BOUNCE_LAYOUTS=0; BOUNCE_SMALL=0; BOUNCE_AT=""
for T in $TRACES; do
  IFS=$'\t' read B L S A < <(awk '
    / offset -?[0-9.]+ d=/ { match($0,/past=[0-9.]+/); p=substr($0,RSTART+5,RLENGTH-5)+0
      inb=(/decel=1/ && p>0.5); if (inb && !was) bounces++; was=inb; next }
    / state cs / { if (!was) next; layouts++
      match($0,/state cs [-0-9.]+ -> [-0-9.]+/); split(substr($0,RSTART+9,RLENGTH-9), ab, " -> ")
      d=ab[2]-ab[1]; if (d<0) d=-d; if (d<1) { small++; at=$0 } }
    END { printf "%d\t%d\t%d\t%s\n", bounces, layouts, small, at }' "$T")
  BOUNCES=$((BOUNCES + ${B:-0})); BOUNCE_LAYOUTS=$((BOUNCE_LAYOUTS + ${L:-0})); BOUNCE_SMALL=$((BOUNCE_SMALL + ${S:-0}))
  [ -n "$A" ] && BOUNCE_AT=$A
done
echo "bounces off the end: $BOUNCES; layouts inside them: $BOUNCE_LAYOUTS; under a point: $BOUNCE_SMALL${BOUNCE_AT:+  ($BOUNCE_AT)}"
[ "$TARGETED" = "1" ] || [ "$BOUNCES" -ge 3 ] || fail "only $BOUNCES bounce(s) off the end in the whole suite — BounceCheck's flicks are not reaching past the end, or the trace signature changed"
[ "$BOUNCE_SMALL" = "0" ] || fail "$BOUNCE_SMALL layout(s) of under a point inside a bounce off the end — a hidden row held at a height it does not have (see $TRACES)"

# When the content shrinks while scrolled to the end (for example, a receipt is
# removed), the scroll view tracks the animating content frame
# (`follow drawn end from`) and the end anchor must not also move the offset. A
# `pin delta=` line during a follow fails. A follow ends at `drawn end reached`,
# `rise start`, or `track=1` (a finger down).
FOLLOWS=0; PINS_IN_FOLLOW=0
for T in $TRACES; do
  read Fn Pn < <(awk '
    /follow drawn end from/ { f++; inf=1; next }
    /drawn end reached|rise start|track=1/ { inf=0; next }
    / pin delta=/ { if (inf) p++ }
    END { print f+0, p+0 }' "$T")
  FOLLOWS=$((FOLLOWS + ${Fn:-0})); PINS_IN_FOLLOW=$((PINS_IN_FOLLOW + ${Pn:-0}))
done
echo "drawn-end follows: $FOLLOWS; anchor pins inside one: $PINS_IN_FOLLOW"
[ "$TARGETED" = "1" ] || [ "$FOLLOWS" -ge 1 ] || fail "no drawn-end follow in the whole suite — nothing shrank under a reader at the end, or the trace signature changed"
[ "$PINS_IN_FOLLOW" = "0" ] || fail "$PINS_IN_FOLLOW anchor pin(s) inside a drawn-end follow — the offset was paid for twice (see $TRACES)"

# Once any message has shown a receipt, some message must show one after every
# commit. ChatScreen.js logs `receipt <id> shown|waiting|leaving|none` on each
# change. Lines less than 0.1 s apart count as one commit, because moving the
# receipt logs the old message's `leaving` before the new message's `shown`.
# `ReceiptHandoffCheck` sends twice within a six-second delivery delay, which
# leaves the message with the receipt third from the end. The state resets
# when the app relaunches (`Running "ChatDemo"`).
NO_WEARER=0; NO_WEARER_AT=""; HANDOFFS=0
for T in $TRACES; do
  # The last field is empty on a clean run. `read` merges consecutive tabs, so
  # an empty field has to come last.
  IFS=$'\t' read V H A < <(awk '
    function ts(l){ match(l,/[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+/); s=substr(l,RSTART,RLENGTH); split(s,p,":"); return p[1]*3600+p[2]*60+p[3] }
    function settle() { n=0; for (r in st) if (st[r]=="shown") n++; if (n>0) ever=1; else if (ever) { viol++; at=last } }
    /Running "ChatDemo"/ { if (pending) settle(); delete st; ever=0; pending=0; next }
    /javascript\] receipt [^ ]+ (shown|waiting|leaving|none)/ {
      t=ts($0); if (pending && t-lastt>0.1) settle()
      match($0,/receipt [^ ]+ (shown|waiting|leaving|none)/); split(substr($0,RSTART,RLENGTH),w," "); st[w[2]]=w[3]
      if (w[3]=="shown") shown_lines++
      pending=1; lastt=t; last=$0; next }
    END { if (pending) settle(); printf "%d\t%d\t%s\n", viol, shown_lines, at }' "$T")
  NO_WEARER=$((NO_WEARER + ${V:-0})); HANDOFFS=$((HANDOFFS + ${H:-0}))
  [ -n "$A" ] && NO_WEARER_AT=$A
done
echo "receipt states logged as shown: $HANDOFFS; commits that left no wearer: $NO_WEARER${NO_WEARER_AT:+  ($NO_WEARER_AT)}"
[ "$TARGETED" = "1" ] || [ "$HANDOFFS" -ge 6 ] || fail "only $HANDOFFS receipt states logged as shown — the rows' receipt log is not reaching the trace, or the suite stopped sending"
[ "$NO_WEARER" = "0" ] || fail "$NO_WEARER commit(s) left no row wearing a receipt after one had (see $TRACES)"

# No keyboard rebuild while a sent balloon animates: a `correction dropped`
# line between `flight … aimed` and `flight … arrived` fails. A text write made
# during an animation defers its correction drop, which rebuilds the keyboard,
# until the animation ends. See ui-metrics.md, "Keyboard rebuild during a send".
# This checks order, not timing, because simulator main-loop turns can take
# seconds during launch.
REBUILDS=0; REBUILD_AT=""
for T in $TRACES; do
  IFS=$'\t' read Rn Rat < <(awk '
    / case / { match($0,/case .*/); c=substr($0,RSTART+5,RLENGTH-5); next }
    /flight [0-9]+ aimed/ { inflight++; next }
    /flight [0-9]+ arrived/ { if (inflight>0) inflight--; next }
    /correction dropped/ {
      if (inflight>0) { n++; if (at=="") { at=c " " substr($0, match($0,/correction .*/) ? RSTART : 1) } }
    }
    END { printf "%d\t%s\n", n+0, at }' "$T")
  REBUILDS=$((REBUILDS + ${Rn:-0}))
  [ -n "$Rat" ] && REBUILD_AT=$Rat
done
echo "keyboard rebuilds while a balloon is in the air: $REBUILDS${REBUILD_AT:+  ($REBUILD_AT)}"
[ "$REBUILDS" = "0" ] || fail "$REBUILDS keyboard rebuild(s) during a send's flight — the news owed for the quiet clear is being given while something is moving (see $TRACES)"

DROPS=0; SLOW_CLEARS=0; SLOW_CLEAR_AT=""
for T in $TRACES; do
  DROPS=$((DROPS + $(grep -c "correction dropped" "$T")))
  # Only the `ours=` part of a clear's `textarea write` counts. The rest is
  # UIKit laying out the keyboard again to capitalise the next sentence, which
  # every app pays. See ui-metrics.md, "Keyboard rebuild during a send".
  N=$(grep -E "textarea write .*len=0" "$T" | grep -oE "ours=[0-9.]+ms" | awk -F'[=m]' '{ if ($2+0 >= 4) n++ } END { print n+0 }')
  SLOW_CLEARS=$((SLOW_CLEARS + N))
  [ "$N" -gt 0 ] && SLOW_CLEAR_AT=$(grep -E "textarea write .*len=0" "$T" | tail -1)
done
echo "at rest after a send: corrections dropped $DROPS; field clears whose OWN cost exceeds 4ms: $SLOW_CLEARS${SLOW_CLEAR_AT:+  ($SLOW_CLEAR_AT)}"
[ "$TARGETED" = "1" ] || [ "$DROPS" -ge 5 ] || fail "only $DROPS correction drop(s) at rest — a write during an animation is not settling, or the suite stopped sending"
[ "$SLOW_CLEARS" = "0" ] || fail "$SLOW_CLEARS field clear(s) over four milliseconds — the keyboard is being told from inside the write again (see $TRACES)"

# When a send animation ends, the animated copy of the balloon must be where
# the row's balloon appears. Compares window y (pt) of the copy
# (`balloon#N gone[flier] winY=`; `gone` without `[flier]` is a row the
# virtualizer hid) with `row R balloon shown winY=` from ChatScreen.js. Allowed:
# 0.5 pt (1 px at 3x is 0.33 pt), or 8 pt within 0.5 s after a `kb h=` line,
# because the copy follows the composer one frame late while UIKit animates it.
# See ui-metrics.md, "Send handover during a keyboard move".
HANDOVERS=0; OFF_HANDOVERS=0; OFF_AT=""; MOVING_HANDOVERS=0; OFF_MOVING=0
for T in $TRACES; do
  IFS=$'\t' read Hn On Mn OMn A < <(awk '
    function ts(l){ match(l,/[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+/); s=substr(l,RSTART,RLENGTH); split(s,p,":"); return p[1]*3600+p[2]*60+p[3] }
    function pair() {
      if (gt>0 && st>0 && (gt-st<0.15 && st-gt<0.15)) {
        n++; d=gy-sy; if (d<0) d=-d
        if (gt-kbt<0.5) { moving++; if (d>8.0) { offmoving++; at=c " " gline " | " sline } }
        else if (d>0.5) { off++; at=c " " gline " | " sline }
        gt=0; st=0
      }
    }
    / case / { match($0,/case .*/); c=substr($0,RSTART+5,RLENGTH-5); next }
    /kb h=/ { kbt=ts($0); next }
    /flier drawn at/ { match($0,/at [0-9.-]+/); fy=substr($0,RSTART+3,RLENGTH-3)+0; ft=ts($0); next }
    /balloon#[0-9]+ gone\[flier\] winY=/ { match($0,/winY=[0-9.-]+/); gy=substr($0,RSTART+5,RLENGTH-5)+0; gt=ts($0); gline=substr($0,index($0,"balloon#"),40); pair(); next }
    /balloon shown winY=/ {
      match($0,/shown winY=[0-9.-]+/); sy=substr($0,RSTART+11,RLENGTH-11)+0; st=ts($0); sline=substr($0,index($0,"row "),40)
      # Prefer the copy position drawn on the same frame as `balloon shown`;
      # the `gone` line comes two or three frames later.
      if (ft>0 && st-ft<0.05 && ft-st<0.05) { gy=fy; gt=st; gline=sprintf("flier drawn %.2f", fy) }
      pair(); next
    }
    END { printf "%d\t%d\t%d\t%d\t%s\n", n, off, moving, offmoving, at }' "$T")
  HANDOVERS=$((HANDOVERS + ${Hn:-0})); OFF_HANDOVERS=$((OFF_HANDOVERS + ${On:-0}))
  MOVING_HANDOVERS=$((MOVING_HANDOVERS + ${Mn:-0})); OFF_MOVING=$((OFF_MOVING + ${OMn:-0}))
  [ -n "$A" ] && OFF_AT=$A
done
echo "send handovers: $HANDOVERS; landing more than half a point from the row: $OFF_HANDOVERS; during a keyboard move: $MOVING_HANDOVERS, of which over eight points: $OFF_MOVING${OFF_AT:+  ($OFF_AT)}"
[ "$TARGETED" = "1" ] || [ "$HANDOVERS" -ge 5 ] || fail "only $HANDOVERS handover(s) traced — the two lines are not both reaching the trace, or the suite stopped sending"
[ "$OFF_HANDOVERS" = "0" ] || fail "$OFF_HANDOVERS handover(s) with the copy landing more than half a point from its row (see $TRACES)"
[ "$OFF_MOVING" = "0" ] || fail "$OFF_MOVING handover(s) during a keyboard move landing more than eight points from the row (see $TRACES)"

# A screen pushed over a screen with the keyboard up must not report that
# keyboard. A push is `editing ENDED … in accessory#A` followed within 0.6 s by
# `accessory#B hosted … screen#S`. In the next 0.6 s, a `kb h=` over 35 pt (more
# than the bottom safe area) for screen#S fails unless its accessory docked to
# the keyboard. Only pushes are checked: a screen under an interactive back
# swipe, or with a focused field outside its accessory, correctly reports a
# keyboard its accessory isn't docked to.
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
[ "$TARGETED" = "1" ] || [ "$PUSHES" != "0" ] || fail "the push-in check saw no pushes — the trace signature changed, or the suite stopped covering it"
[ "$LEAKED" = "0" ] || fail "$LEAKED reading(s) of the outgoing screen's keyboard on a screen just pushed over it (see $TRACES)"
# The keys come back promptly after the `+` card closes. A close that stood the
# keys down (`panel KEYS stood down`) is followed by `panel DISMISS`, and their
# return (`panel KEYS returning`, `sliding away`, or `not coming back`) must
# begin within 0.8 s (a close whose app was torn down before the keys came
# back is not one: the next stand-down starts over): the zoom transition's dismissal reports the card gone
# about a second after it has left the keys, and a return that waits for the
# report lands on the reader's next scroll as a hitch.
LATE_KEYS=0; CLOSES=0; LATE_AT=""
for T in $TRACES; do
  read L C A < <(awk '
  function ts(l){ match(l,/[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+/); s=substr(l,RSTART,RLENGTH); split(s,p,":"); return p[1]*3600+p[2]*60+p[3] }
  /panel KEYS stood down/ { down=1; start=0 }
  /panel DISMISS$/ { if (down) start=ts($0) }
  /panel KEYS (returning to|sliding away|not coming back)/ { if (start) { closes++; d=ts($0)-start; if (d>0.8) { late++; at=at sprintf(" %.2fs", d) } } start=0; down=0 }
  END { print late+0, closes+0, (at=="" ? "-" : at) }' "$T")
  LATE_KEYS=$((LATE_KEYS + L)); CLOSES=$((CLOSES + C)); [ "$A" = "-" ] || LATE_AT="$LATE_AT$A"
done
echo "card closes that stood the keys down: $CLOSES; keys returned late: $LATE_KEYS${LATE_AT:+  ($LATE_AT)}"
[ "$TARGETED" = "1" ] || [ "$CLOSES" != "0" ] || fail "the keys-return check saw no card closes — the trace signature changed, or the suite stopped covering it"
[ "$LATE_KEYS" = "0" ] || fail "$LATE_KEYS card close(s) gave the keys back more than 0.8 s later (see $TRACES)"
if [ "$TARGETED" = "1" ]; then
  echo "TARGETED GREEN"
else
  mkdir -p "$(dirname "$LAST_GREEN")"
  git rev-parse HEAD > "$LAST_GREEN"
  echo "GATE GREEN"
fi
