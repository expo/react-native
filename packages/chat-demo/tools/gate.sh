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
# SendDrive, ReactionShot, RevealShot and TreeDump drive the app for recordings
# and dumps rather than asserting anything, and cost three and a half minutes.
# Ask for them when you want the footage.
RECORDERS=${GATE_RECORDERS:-0}
DD=${DD:-/tmp/chatdemo-rel}
if [ "$RECORDERS" = "1" ]; then EXPECTED_CASES=${EXPECTED_CASES:-82}; else EXPECTED_CASES=${EXPECTED_CASES:-71}; fi
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
#
# ReactCommon counts as native and was missing from this list until a Yoga
# change went through the gate unchecked. Nothing caught it: the executable is
# not hashed, and `built=`/`installed=` below compare the JS BUNDLE, which a
# native-only change leaves byte-identical. The build happened to be fresh, and
# that was luck rather than evidence.
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
  CLASSES=$(echo "$CLASSES" | grep -vE "^(SendDrive|ReactionShot|RevealShot|TreeDump)$")
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
# `--level debug`: the app echoes at info level so the store never keeps it,
# and the rows' receipt lines are `console.log`, which arrives at debug.
lane() {
  local sim=$1 classes=$2 log=$3 trace=$4 bundle=$5
  local args=()
  local c
  for c in $classes; do args+=(-only-testing:ChatDemoUITests/$c); done
  rm -rf "$bundle"
  # Both subsystems: the scroll view's trace, and the rows' own word on their
  # receipts, which `console.log` puts under React's log subsystem.
  xcrun simctl spawn "$sim" log stream --level debug \
      --predicate '(subsystem == "dev.expo.keyboard") OR (subsystem == "com.facebook.react.log")' \
      --style compact > "$trace" 2>&1 &
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
# The transcript must not be moved twice in one pass, to two different answers.
#
# `topDelta` preserves where the TOP of the content was; a bottom-anchored view
# at its end is then scrolled back to the BOTTOM by the same function. Both
# writes land, and the first one is visible: reported from a phone as the chat
# jumping and coming back by 113 points — the screen's own top inset — as a ten
# thousand row conversation opened.
#
# The signature is the pair: an applied `topDelta=X` and, within the next few
# offset writes, a `d=-X` followed by a `d=+X`. Looked for rather than the fix
# being trusted, because the fix is a predicate and a predicate can come back.
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

# And the GENERAL form of the same fault, which that check is one instance of.
#
# The scroll view writes its offset through one door, which counts the writes in
# a mounting transaction and stamps each with the intent that asked — so a `#2`
# is two intents landing in one transaction, caught in the act rather than
# reconstructed from a pair of deltas three days later.
#
# Not an assertion that it is ZERO. Two intents in one transaction is normal
# when the second is a genuine re-evaluation: the bar's height settles from 68.0
# to 68.7 and the end really does move. What is worth knowing is the WORST one,
# because the faults this replaces looked like four and five writes over the
# same thirty-four points, and a number that creeps says an intent has started
# fighting another one again.
#
# The count is per TRANSACTION and not per gap between transactions, which this
# check established the hard way on its first run: seventeen, all of them inset
# changes arriving between two mounts, each a good response to an inset that had
# genuinely moved. A count that cannot tell a collision from a sequence is worse
# than no count.
#
# The reasons are printed beside it, because "which two" is the whole question
# and a count alone sends the next person back to the trace.
WORST=0
WORSTAT=""
for T in $TRACES; do
  N=$(grep -oE "write .* #[0-9]+ " "$T" | grep -oE "#[0-9]+" | tr -d '#' | sort -n | tail -1)
  [ -n "$N" ] && [ "$N" -gt "$WORST" ] && { WORST=$N; WORSTAT=$(grep -oE "write .* #$N .*" "$T" | tail -1); }
done
echo "most offset intents in one transaction: $WORST${WORSTAT:+  ($WORSTAT)}"
[ "$WORST" -le "${MAX_OFFSET_INTENTS:-3}" ] || fail "$WORST offset intents in one transaction, expected at most ${MAX_OFFSET_INTENTS:-3}"
[ "$JUMPS" = "0" ] || fail "$JUMPS top-inset correction(s) the bottom anchor then undid (see $TRACES)"

# A bounce off the end does not re-lay out the transcript by a rounding.
#
# `BounceCheck` flicks a hundred-row chat past its end, and the trace says what
# happened inside each bounce: an `offset` line with `decel=1` and `past>0` is
# UIKit bringing the list back from beyond the end, and a `state cs` line under
# it is the content changing size while it was out there. A receipt landing is
# a change of thirteen points and is allowed. A change of LESS THAN A POINT is
# nothing real: it is a row whose hidden placeholder and rendered height
# disagree by a rounding, re-laid because a sweep flipped its mode — measured
# at one per bounce on the simulator, and on a device it fed a loop of ninety
# layouts in two hundred milliseconds when UIKit's clamp reached the row
# virtualiser as a scroll event (see `-[EXPScrollViewInner holdOffsetWhile:]`).
# The bounces are counted so that a suite with no flick in it cannot pass this
# by saying nothing.
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
[ "$BOUNCES" -ge 3 ] || fail "only $BOUNCES bounce(s) off the end in the whole suite — BounceCheck's flicks are not reaching past the end, or the trace signature changed"
[ "$BOUNCE_SMALL" = "0" ] || fail "$BOUNCE_SMALL layout(s) of under a point inside a bounce off the end — a hidden row held at a height it does not have (see $TRACES)"

# A receipt leaving is followed on its own curve, not paid for twice.
#
# Content that shrinks under a reader at the end is followed on the DRAWN
# end — the content view's frame, which the transition engine animates one
# mounting transaction at a time — and while that follow runs the anchor
# stands down. A `pin` inside a follow is the anchor paying, frame by frame,
# for a distance the follow has already covered: that was the rough receipt,
# 12.7 at once and 7.2 more over eighty milliseconds, coming to rest short
# of the end. A follow ends when the drawn end reaches the laid-out one, or
# when a rise or a finger takes the offset over. The follows are counted so
# that a suite in which nothing ever shrank under a reader cannot pass this
# by saying nothing. On the build before this, the same window held
# sixty-four pins across six follows.
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
[ "$FOLLOWS" -ge 1 ] || fail "no drawn-end follow in the whole suite — nothing shrank under a reader at the end, or the trace signature changed"
[ "$PINS_IN_FOLLOW" = "0" ] || fail "$PINS_IN_FOLLOW anchor pin(s) inside a drawn-end follow — the offset was paid for twice (see $TRACES)"

# Once a row has worn a receipt, some row wears one at the end of every commit.
#
# Every row logs its receipt state as it changes — `receipt <id> shown`,
# `waiting`, `leaving`, `none` — and a handoff is one commit in which the old
# wearer goes to `leaving` and the new one to `shown`. Read per commit, not per
# line: the rows log in tree order, so inside one commit the old wearer's line
# comes before the new one's, and a count taken between them would say zero
# about a handoff that was whole. Lines closer than a tenth of a second are one
# commit. The bug this stands over left no row `shown` for the length of the
# delivery delay: two sends inside it put the wearer third from the end, and
# the rule was written as "the last two". `ReceiptHandoffCheck` makes that
# sequence with the delay stretched to four seconds; the empty chat's first
# message, which has never had a receipt to keep, is not a violation, and the
# app relaunching between cases starts the count again.
NO_WEARER=0; NO_WEARER_AT=""; HANDOFFS=0
for T in $TRACES; do
  # The line that names a violation is empty on a clean run, and `read`
  # collapses the tabs around an empty field — so it is read last.
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
[ "$HANDOFFS" -ge 6 ] || fail "only $HANDOFFS receipt states logged as shown — the rows' receipt log is not reaching the trace, or the suite stopped sending"
[ "$NO_WEARER" = "0" ] || fail "$NO_WEARER commit(s) left no row wearing a receipt after one had (see $TRACES)"

# The field's clear after a send is a write, and the keyboard is told AT REST.
#
# Measured: the empty write is 0.9ms; the input system being told about it —
# from inside the setter, as the keyboard recomputes its predictions — is
# twelve on a simulator and thirty to fifty on a phone, and it was paid on the
# flying balloon's first frame, the hole at the start of every send's rise.
# The clear is quiet now; the queued correction is dropped and the news given
# when the host says it has stopped animating, or before the next edit
# (`correction dropped`, `input system told`). A clear that still takes four
# milliseconds has been told about from inside again. The drops and tells are
# counted so that a suite that stopped sending cannot pass this by saying
# nothing.
#
# AND NOT DURING THE FLIGHT, which is the check below it and the reason the
# deadline had to go. Telling the input system rebuilds the keyboard, and on a
# phone the whole turn is 113 milliseconds — seven dropped frames. It was
# scheduled half a second after the clear, which was chosen as "past a send's
# choreography" and never measured against one: three device sends put it 545,
# 551 and 553 milliseconds in, against a throw that runs for 769. Reported as
# "I still feel there's a frame drop sometimes".
#
# The test is the INVARIANT, not a number: nothing that rebuilds the keyboard
# may happen between a flight being aimed and its arrival. A timing threshold
# could not be used here anyway — a simulator's main loop turns run to three
# seconds during a launch — and this asks the question the reader is asking.
# Proven to fire: on the build that carried the deadline it found 63 of them,
# one pair per send.
REBUILDS=0; REBUILD_AT=""
for T in $TRACES; do
  IFS=$'\t' read Rn Rat < <(awk '
    / case / { match($0,/case .*/); c=substr($0,RSTART+5,RLENGTH-5); next }
    /flight [0-9]+ aimed/ { inflight++; next }
    /flight [0-9]+ arrived/ { if (inflight>0) inflight--; next }
    /input system told|correction dropped/ {
      if (inflight>0) { n++; if (at=="") { at=c " " substr($0, match($0,/(input system|correction) .*/) ? RSTART : 1) } }
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
  # OUR milliseconds, not the total. A send's clear costs ~19ms and almost none
  # of it is ours: emptying the field puts the caret at a sentence start, the
  # keyboard flips keyplane to shifted, and UIKit relayouts its input window
  # through Auto Layout inside `performTaskOnMainThread:waitUntilDone:`. That
  # is sampled, not assumed, and it is not a defect in this code — it is what
  # every app pays to make the keyboard capitalise the next sentence.
  # Budgeting the TOTAL here would fail the gate for UIKit's work and teach the
  # next reader that this code is slow.
  N=$(grep -E "textarea write .*len=0" "$T" | grep -oE "ours=[0-9.]+ms" | awk -F'[=m]' '{ if ($2+0 >= 4) n++ } END { print n+0 }')
  SLOW_CLEARS=$((SLOW_CLEARS + N))
  [ "$N" -gt 0 ] && SLOW_CLEAR_AT=$(grep -E "textarea write .*len=0" "$T" | tail -1)
done
echo "at rest after a send: corrections dropped $DROPS; field clears whose OWN cost exceeds 4ms: $SLOW_CLEARS${SLOW_CLEAR_AT:+  ($SLOW_CLEAR_AT)}"
# Only the correction DROP is owed now. The input system is told inline by the
# write — that news is the keyboard's keyplane change, and withholding it
# withheld the autocapitalisation with it, which is the bug this replaced.
[ "$DROPS" -ge 5 ] || fail "only $DROPS correction drop(s) at rest — a write during an animation is not settling, or the suite stopped sending"
[ "$SLOW_CLEARS" = "0" ] || fail "$SLOW_CLEARS field clear(s) over four milliseconds — the keyboard is being told from inside the write again (see $TRACES)"

# The flying copy lands where the row is.
#
# At the handover the copy leaves the window (`balloon#N gone[flier] winY=`;
# the app names it, because a row the virtualiser hides writes the same line
# without the name) and the row's own balloon is shown (`row R balloon shown
# winY=`). Half a point is the allowance: a third is one pixel, the grid the
# row sits on. This has caught three separate faults — a prediction of the
# scroll view's resting offset, a stale row position, and a journey measured
# from the bar's top when the copy hangs from its bottom — each of which put
# the balloon tens of points from its row at the moment the two swapped.
#
# A handover WHILE THE KEYBOARD MOVES is judged, but not to the same number,
# and the number it is judged to is a measured floor rather than a tolerance.
#
# The error is `progress × (row staleness − field staleness)` and the two do
# not cancel, because the ends move at different rates: a keyboard coming up
# moves the bar 79 points in its first frame while the transcript's offset does
# not move at all — clamped, with nothing to scroll. Read through JavaScript
# events that put the copy, which hangs from the bar, 80 points off its path:
# drawn at 508.4, 425.7, 383.5 and then 454.3 on four consecutive frames with
# its target standing still, and 8.2 out at the swap.
#
# Both ends are now stated by the views that draw them, into animated values
# the event drives natively — same main-thread call, same frame. Measured on
# the same case afterwards: the excursion is 13 points and the swap is 3.8.
#
# WHAT IS LEFT IS ONE FRAME OF THE KEYBOARD'S OWN MOTION, and it cannot be
# read. The copy rides the bar because at `progress` zero it IS the field, so
# its place has to be corrected for wherever the bar is being drawn — and a bar
# animated by UIKit is only knowable from its presentation layer, which is the
# frame already on screen. The correction is therefore always for the previous
# frame, and what is left is `progress` times one frame of the keyboard's
# travel.
#
# THAT IS WHY THIS NUMBER IS A SPREAD AND NOT A MEASUREMENT. How far out a
# handover lands depends on where in the keyboard's rise the send happens to
# finish, and the rise's per-frame travel runs from 86 points at its first
# frame to under one at its last. Three runs of the same case gave 3.8, 4.5 and
# 5.8; a threshold of 5, set from the first of those alone, failed the third.
# Eight is the top of that spread with a frame of headroom. It is not tight
# enough to catch the last point of lag and is not meant to be — the faults
# this check exists for put the balloon twenty to eighty points from its row,
# and the number that actually moved is in the commit that changed it: 8.2
# before both ends were driven natively, 3.8 to 5.8 after.
#
# Modelling the keyboard's curve instead of measuring it would close the last
# frame, and is not worth what it costs to be wrong about.
#
# A handover with nothing moving — what a reader meets — is still half a point.
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
      # The copy as DRAWN on the frame the row appeared, which is the moment a
      # reader sees the two swap — `gone` is two or three frames later, and the
      # copy is invisible by then.
      if (ft>0 && st-ft<0.05 && ft-st<0.05) { gy=fy; gt=st; gline=sprintf("flier drawn %.2f", fy) }
      pair(); next
    }
    END { printf "%d\t%d\t%d\t%d\t%s\n", n, off, moving, offmoving, at }' "$T")
  HANDOVERS=$((HANDOVERS + ${Hn:-0})); OFF_HANDOVERS=$((OFF_HANDOVERS + ${On:-0}))
  MOVING_HANDOVERS=$((MOVING_HANDOVERS + ${Mn:-0})); OFF_MOVING=$((OFF_MOVING + ${OMn:-0}))
  [ -n "$A" ] && OFF_AT=$A
done
echo "send handovers: $HANDOVERS; landing more than half a point from the row: $OFF_HANDOVERS; during a keyboard move: $MOVING_HANDOVERS, of which over eight points: $OFF_MOVING${OFF_AT:+  ($OFF_AT)}"
[ "$HANDOVERS" -ge 5 ] || fail "only $HANDOVERS handover(s) traced — the two lines are not both reaching the trace, or the suite stopped sending"
[ "$OFF_HANDOVERS" = "0" ] || fail "$OFF_HANDOVERS handover(s) with the copy landing more than half a point from its row (see $TRACES)"
[ "$OFF_MOVING" = "0" ] || fail "$OFF_MOVING handover(s) during a keyboard move landing more than eight points from the row (see $TRACES)"

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
