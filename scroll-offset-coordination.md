# Coordinating a scroll view's state, from first principles

Written 2026-09-19, after the third bug of one shape in
`EXPScrollViewComponentView.mm`.

## The observation that starts it

Ten sites write `contentOffset`, spread across seven callbacks:

| where | callback |
|---|---|
| the content anchor | `mountingTransactionDidMount` |
| the inset delta (×2) | `_applyInsets` |
| keeping a focused field visible | `_keepFocusedFieldVisible` |
| the content-size clamp | `updateState` |
| the legality clamp | `_clampOffsetIfPastEnd` |
| the rise, start and end (×2) | `_riseTo` |
| the rise, per frame | `_riseTick` |
| scroll-to-latest | `_scrollToLatestAnimated` |

plus UIKit, which clamps the offset inside `setContentSize:` and moves it under a
finger without asking anyone.

**The order of those callbacks is not this file's to choose.** It is decided by
UIKit and by Fabric's mounting. Every bug of the last three days has been two of
those sites writing the same number in the same pass, with the wrong one
surviving:

- `topDelta` applied when the bottom-follow was about to answer — the transcript
  moved 113 points and came back.
- The anchor's correction computed and discarded while decelerating — 19 of 20
  dropped, seen as judder.
- `shrink-follow` starting an animated rise one millisecond before the anchor
  computed the *same* correction — seen as a 33-point wobble on load.

Each was fixed by adding a guard: *don't do X when Y will answer.* That is
quadratic in the number of writers, every new writer needs a guard against every
existing one, and the guards are written from whichever bug was in front of us.

**The scroll view has ten authors and no editor.**

## What is actually being decided

Once per transaction, given that the content, the insets and the viewport may
all have changed, there is exactly ONE question: *where should the offset be?*

One question deserves one answer, computed once. The present design has ten
parties each computing a delta and writing it, and a lattice of guards to stop
them colliding. The guards are the design's way of apologising for its shape.

## Four principles

### 1. An intent is not a write

Each mechanism should state what it WANTS, in terms that survive being compared
with what another mechanism wants:

| mechanism | intent |
|---|---|
| the anchor | "row R stays at window-y 312" |
| the bottom follow | "the end is visible" |
| the inset delta | "the top of the content stays where it was" |
| focus | "the focused field is visible" |
| scroll-to-latest | "the newest row is visible" |
| the clamp | *not an intent — a constraint* |

Stated this way two of them can be compared, which is impossible when each has
already written a number and left.

### 2. Intents are RANKED, and the ranking is about whose intent it is

Not "which callback ran first", which is what decides today.

1. **The reader's own hands.** A finger, and the deceleration it left behind.
   Never corrected, ever. This is the only absolute.
2. **An explicit request.** Scroll to top; scroll to latest; the send that
   follows a message to the end. The reader asked.
3. **Preserving what is on screen.** The anchor. Nobody asked for it, and that
   is the point: the reader is reading, and the content moving under them is
   the thing to prevent.
4. **Following the end.** A convenience for a reader who was already there.
5. **Legality.** The clamp, which is not ranked at all because it is applied to
   the winner rather than competing with it.

Every bug above is two mechanisms at DIFFERENT ranks where the lower one won by
running first. The 33-point wobble is rank 4 beating rank 3.

### 3. Whether to animate follows from the MEANING of the move, not from who won

This is the sharpest of the four and it would alone have prevented the last bug.

- **A compensation** — a move that exists so the reader sees NOTHING change —
  is instant, always. Animating it is a contradiction in terms: the entire
  purpose is that nothing appears to move, and an animation is the appearance of
  moving.
- **A journey** — taking the reader somewhere they were not — is animated,
  because a cut is disorienting and the movement is the message.

Today `pin` is instant and `rise` is animated as a property of *which mechanism
it is*. So when `shrink-follow` (a journey mechanism) was handed a compensation
to perform, it animated it, and 33 points of "you should see nothing" became a
tenth of a second of visible sliding. The same correction, to the same number,
was invisible going up and visible going down.

### 4. The invariant is checkable, so check it

**At most one offset write per transaction**, and the trace says which intent
won and why the others stood down.

The gate already greps for `offsets written twice in one pass` — added for the
113-point bug, and specific to it. Generalised, it retires the whole class:
every collision becomes a gate failure naming both intents instead of a report
from a phone three days later.

## How to get there without breaking it

This is the most delicate code in the file — it carries three documented
regressions ("sending pulls the transcript down", "the jump when a message is
sent from an over-scrolled transcript", the dropped corrections) and the gate
has a case standing over each. Staged, so each step is separately verifiable:

**Stage 1 — a funnel, with no behaviour change.** Every one of the ten sites
calls one `-_writeOffset:reason:animate:`. It writes exactly what it is given.
Nothing is reordered, nothing is refused. This is refactoring, and the gate
proves it: 69 cases green means behaviour is identical.

**Stage 2 — the trace, and then look.** The funnel logs every write with its
reason. Run the gate, the send trial, the scroll trial, and a 10k load; collect
where two writes land in one transaction. This is the step that replaces my
guesses about which collisions matter with a list of the ones that happen.
Expect surprises — today's three were all surprises.

**Stage 3 — one resolution point.** Mechanisms file intents; a resolver picks by
rank, applies the clamp, writes once. The funnel from stage 1 becomes its only
exit.

**Stage 4 — animation by meaning.** Compensation instant, journey animated, and
delete the per-mechanism choice.

**Stage 5 — the gate check.** Two writes in one transaction is a failure. The
guards added for the three bugs can then come out, because the invariant they
each approximated is now stated once and enforced.

Stages 1 and 2 are worth doing whatever happens to 3–5: they cost little, they
cannot change behaviour, and they turn "I think these collide" into evidence.

## What actually landed, and where it differed from the plan

All five stages are in (`a9e67b290ad` … `1028372552c`). Two things came out
differently from the plan above, and both are worth knowing before reading the
code against it:

**Stage 3 turned out to be about *when* rather than *which*.** The plan expected
mechanisms that disagree about *where* the offset should be, resolved by rank.
The trace showed the dominant collision was four askers who all wanted the same
thing — the end — and disagreed only about *when* it was evaluated, because
`-_maxOffsetY` moves while the insets settle. So "be at the end" became an intent
recorded during a transaction and evaluated once at its end. Ranking is still
right in principle; it just was not the bug that was happening.

**The transaction window does not cover `updateState`.** The deferral holds while
a mounting transaction is open. `updateState` — where the content size arrives
and `shrink-follow` fires — runs *outside* that window, so a shrink-follow filed
as an intent wrote immediately anyway. The device trace showed it. The fix was
not to widen the window but to apply principle 3 directly: `shrink-follow` is a
compensation, so it is instant. A compensation that lands in the same frame as
the change it compensates for needs no coordination with anything.

**The invariant check was wrong twice before it was right.** Seventeen, then
thirteen "intents in one transaction" — both times inset changes arriving
*between* mounts during a keyboard animation, each a correct response to an
inset that had genuinely moved. A sequence, reported as a collision. The count
now exists only inside a transaction (`#-` outside), because that is the only
window it can claim anything about. Green at 2.

## What this does not fix

The 33-point wobble's *cause* was elsewhere, and is now also fixed
(`6fc53740fca`): one row oscillating 60 → 93 → 60, because a Hidden event
carried a rect swept while the row was still a placeholder and applied after its
Prerender had mounted. A hidden row now holds the height it currently has, read
synchronously. That is a VirtualView correctness fix, not a coordination one.

What remains true: rows still *realise* from a fixed `ESTIMATED_ROW_HEIGHT = 60`
to real heights of 46.6–93 on first sight, so the content size still moves on a
first load. The anchor absorbs that going up, and the instant shrink-follow
absorbs it going down. A list whose first-sight placeholders are a guess still
has a scrollbar that breathes; that is the separate piece of work.

## The model as it exists today, written down (2026-09-20)

Two small state machines, neither of them explicit in the code, both of them
reconstructed from traces. Recorded here so a proposal can be checked against
what is, not against what I remember.

### Who owns the offset

| state | owner | how the code knows | what may write |
|---|---|---|---|
| REST | nobody | none of the below | clamps (`size-repair`, `clamp`, `shrink-follow`) |
| READER | a finger, or its deceleration | `isTracking \|\| isDecelerating` | nothing |
| RISE | an animated journey | `_riseLink != nil` | the rise, and its retargets |
| HOLD | the anchor keeping row R still | *no state* — recomputed per transaction from `_firstVisibleFrameBefore` | the anchor |

HOLD has no persistent representation. It is re-derived on each mounting
transaction and forgotten between them. A change that is animated over a
transition spans many transactions, and between two of them the view believes
it is at REST — which is when `shrink-follow` fired on a receipt's move and paid
a compensation the anchor was already paying frame by frame. The offset ended
7.3 past the end and stayed there until the next send's rise started from
`-33.3` to correct it.

The one input that would let HOLD end correctly: whether a content change is
instant or animated over T. `CSSLayoutTransitions::flights_` knows per surface;
the scroll view is told only the final layout, at once, either way.

### The receipt

| state | drawn | flags | leaves by |
|---|---|---|---|
| NONE | nothing | `showsReceipt != 'shown'`; `swappedReceipt` reset | the row becoming the newest sent |
| ARRIVING | the first words | `shownReceipt.status == null` → `setShownReceipt(said)` at once, no swap | ink settling: `RECEIPT_SETTLED_MS` from `receiptSaidAt` |
| HOLDING | the words, solid | the effect's `wait = settled + RECEIPT_HOLD_MS` | the timer |
| LEAVING | fading out | `swappingReceipt = true` | `RECEIPT_SWAP_AT_MS` |
| ARRIVED | the new words | `shownReceipt = said; swappedReceipt = true; receiptSaidAt = now` | back to HOLDING |

The "held nothing" fault was HOLDING being computed as a deadline from ARRIVING
rather than as a duration from the end of ARRIVING. The "switches too roughly"
report is LEAVING: it is an animated content change (`h 13→0`, `pb 8→2`) that
the scroll view has no HOLD state to span.

**The two machines couple at LEAVING.** A receipt leaving is exactly a content
change the scroll view must hold through, and today neither side represents
that: the receipt does not know it is being scrolled around, and the scroll
view does not know the change is animated.

## Assessed against a device trace (2026-09-20, `e65c06c8bb5`)

A trace with three symptoms — a send that did not rise, a balloon that landed
on the previous row, a two-row jump on the next send — had one cause, and the
two machines above would have prevented none of it.

**The cause.** The anchor's rule was either/or: the anchor row's top travelled
→ pin; it did not → follow the end. A send appended while the previous row's
receipt was still sliding into place (a separate commit, 10 ms after the
receipt-move) satisfied both — the row's top had moved 0.9 of a point that
frame — and the pin won. Nobody asked for the end again. The flight had aimed
at where the follow would have put the row, so it landed one row short; the
next send's `scrollToLatest()` found the offset 57.7 short and rose 101.7 in
one curve.

**The fix.** A pin is a compensation (instant, for what changed above); a rise
is a journey (animated, for what arrived below). They are different kinds of
move and compose: pin first, then the follow, with the rise starting from the
pinned offset and settled at the transaction's end. The ten-thousand-row open
pins to the new end and the rise has nowhere to go — unchanged.

**What the model got wrong.** Both machines above are about *who writes*.
This trace's defects are about *what kind of change arrived* — instant or
animated over 335 ms — and the scroll view is told only the final layout,
either way. Stage 4 chose instant-vs-animated by *mechanism* (shrink-follow is
a compensation, so instant), which is right for a row realising on a load and
wrong for a receipt leaving on a curve: that is the "rough receipt".

**What to build instead.** The transition engine already animates the content
view's own frame (`flight t=718 454 → 441.3`). If "the end" is the *drawn* end
rather than the state's final number, an animated shrink is followed on its
own curve with no new input, `shrink-follow` and `size-repair` collapse into
one rule, and an instant change is the one-frame case of the same rule. The
reader's states — AT-END, READING, TOUCHING, RISE — each get one absolute
per-transaction rule, so a spring's sub-half-point tail cannot be dropped the
way the anchor drops 5.4 points of it today.

## The third party: whoever else is listening (2026-09-20, `d0a383829ee`, `2c30d9dd375`)

The model above has writers. It had no column for *readers*, and the next
device trace was about one.

A flick past the end left the list bouncing back, and every content change
during the bounce made UIKit clamp the offset to the end inside
`setContentSize:`. This view put it back in the same call and ignored its own
`scrollViewDidScroll:` in between. But the row virtualiser is a second delegate
through the splitter, and it heard both writes: a sweep at the end, a sweep two
hundred points out, each flipping the modes of the rows at the prerender edge,
each a React commit — and each commit that changed the content size clamped
again. Ninety layouts in two hundred milliseconds. UIKit's bounce stalled for
sixty-seven of them.

**A write with observers is a broadcast.** Undoing it afterwards does not
un-deliver it. The repair — write, then write back — was an honest attempt to
keep the offset the reader's, and it was right about *whose* offset it was and
wrong about *when*: the moment to keep UIKit off the number is before it
writes, not after. Upstream's `RCTEnhancedScrollView` had the shape already:
`setContentOffset:` returns while a flag is set, and the size changes under a
held offset. `EXPScrollViewInner` does the same now, around the size and the
insets both; `size-repair`, `inset-repair` and the mid-repair flag are gone.

**What this changes in the model.** The invariant "one intent, one write, at
the end of the transaction" was stated for this view's writers and now covers
UIKit's too: nothing writes the offset during a geometry change, so nothing is
delivered. The `contentShift` machinery — the difference between the offset the
tree was told and the one drawn — existed to account for the unreported repair
and is now always zero; it can go.

**What the instrument measures.** Inside a bounce off the end (`decel=1`,
`past>0` on the offset line), a content change of under a point is a rounding
disagreement and nothing else — a receipt is thirteen — so the gate allows
none, and counts the bounces so that a suite with no flick cannot pass by
saying nothing. On the unfixed app the simulator gave one per bounce, four of
four, before the fix existed.

**And what it then caught.** The engine fix alone left one under-a-point
layout per flick — the same one. The fuel was not the rounded `offsetHeight`
I had blamed; it is that a placeholder sized from JavaScript can only ever be
sized from a *mounted* rect, and Yoga mounts rows rounded to the pixel grid by
their edges: a 56.5-point row mounts as 56.67 or 56.33 by where it sits. A
placeholder given that number is off by up to a sixth of a point, every row
below shifts by it, their edges flip by a third, and the visible rows move a
pixel. That is inherent to VirtualView's hidden mode, not to any change here.
The row's true height exists in one place — Yoga's measured dimension, kept
beside the rounded one — so `VirtualViewShadowNode` now takes it at the moment
the row becomes hidden and holds it as the placeholder's height until the row
renders again. The fourth party, then: **the layout engine's rounding**, which
makes "the same height" two different numbers depending on who is asking.

## The drawn end, landed (2026-09-20, `b3330058b70`)

The proposal three sections up — "the drawn geometry is the clock" — turned
out to need no plumbing from the transition engine at all. The engine animates
the content view's frame one mounting transaction per frame, and each of those
transactions already reached the scroll view: they were the source of the
per-frame `pin` lines. So the scroll view reads the drawn end itself —
`CGRectGetMaxY` of the content view's frame in scroll coordinates — and a
shrink under a reader at the end is followed there, one instant write per
transaction, until the drawn end reaches the laid-out one. The anchor stands
down for the length of it; a rise or a finger takes the offset over and the
follow yields; a change with no transition is the one-frame case.

What that changes in the model's tables: AT-END now has a rule of its own for
a shrink — *be at the drawn end, every transaction* — and HOLD is no longer
asked to span a transition it cannot see. Growth at the end is still two
mechanisms: a row appended is a journey (the rise), and a receipt opening under
the newest balloon is also a rise today, on the same constants as the engine's
curve, which is why it looks right; making it a drawn-end follow too, and
keeping the rise for appended rows only, is the remaining unification.

Gate: `drawn-end follows: N; anchor pins inside one: 0`, N at least one. The
build before held sixty-four pins across six follows.

## The receipt machine, with a voice (2026-09-20, `d262dd30ac4` … `f877a1d3192`)

The receipt table above listed five states behind five flags and no way to
see them. Two things changed.

**Who wears it.** "The receipt stays on the previous sent message until the
newest one is ready" was coded as *the last two sent rows*. Two sends inside
the delivery delay put the wearer third from the end, and it dropped its line
the instant the second was sent — the device's "sometimes, sending makes the
prior Delivered leave at once". The wearer is now found by what it has, not by
where it sits: the newest sent row with a receipt; the newest sent row holds
the space; the wearer before it is the one leaving.

**The rows say what they are.** Each row logs `receipt <id> shown | waiting |
leaving | none` as it changes, through `console.log`, which reaches the system
log in Release; the gate's trace listens to React's log subsystem beside the
scroll view's, and holds one invariant per commit: once any row has worn a
receipt, some row wears one. Per commit, because the rows log in tree order
and a count taken between an old wearer's `leaving` and a new one's `shown`
would call a whole handoff a gap. Synthesised from the old rule's sequence, the
check reports exactly one violation.

Worth keeping from the detour: an XCUITest accessibility poll first "proved"
a two-second gap that a screenshot of the same instant showed was not there —
the whole transcript was missing from the tree while the screen showed every
balloon. The app's own word is the instrument for a state machine; a tree
snapshot of a busy app is not.

## The fifth party: the keyboard, and what a main-thread animation cannot afford (2026-09-20, `8cda0553810`)

"The scroll view is pushed up more harshly than Messages." The device trace
said where: on every send, the rise's first frames came thirty to fifty
milliseconds apart, with no line of any kind in the gap, and the offset and
the flying balloon both twenty points further on when the frames resumed. Not
a mounting transaction — those were twelve to fifteen and traced. A run-loop
observer and a bracket on the field's controlled write found it on the
simulator: the field letting go of the sent text, on the flying balloon's
first frame, by design (so the words are never nowhere), costs twelve
milliseconds there. Two more brackets split it: setting the text, 0.9ms;
telling the keyboard — `textWillChange:`/`textDidChange:` to its delegate,
sent from inside the setter as it recomputes its predictions for an empty
document — the rest. Three gates in a row were failed by my own new line
before the split was right; each time the number named the next half.

**The structural point.** Messages' throw and scroll are Core Animation; a
main-thread hole cannot freeze them. Ours are main-thread animations — the
rise is a display link writing the offset, the flight is the transition
engine's per-frame mounting transactions — and both interpolate on the clock,
so every hole is a jump when the frames resume. Anything that costs a frame
inside a send's choreography is therefore visible, and the keyboard's
synchronous reaction to a programmatic clear costs several.

**What landed.** The send's clear is quiet: the input delegate is detached
around the unmark and the write, and the field owes the news. It is settled
half a second after the last quiet clear — past the choreography, and a
second send inside that half second moves it past its own — or before the
next edit, whichever is first; at that moment the correction queued against
the sent text is dropped and then the keyboard is told, in that order, at
rest. Nothing is skipped, only moved. A command from the app at the send's
tap was tried first for the drop and arrived asynchronously, twenty
milliseconds later, on the frame it was meant to spare: a JavaScript command
is not a synchronous call, and a fix that depends on it being one is not a
fix.

**What remains.** The append's mount, twelve to fifteen milliseconds on a
phone, a frame and a half at the start of every rise; and, more generally,
that the rise's and the engine's clocks start at the transaction rather than
at the first drawable frame, so any long mount is eaten from the front of the
curve. Starting both clocks on the first tick is the next change in this
line.

## The handover: three fractions of a point (2026-09-21, `13ee148b779`)

"The chat bubble animates into place and then jumps down a little." The
flying copy and the row's own balloon each got a line on the trace's clock —
`balloon#… gone[flier] winY=` as the copy leaves the window, `row … balloon
shown winY=` as the row appears — and the phone said 402.3 against 402.7: the
copy lands a third of a point, one pixel, above its row and drops onto it at
the swap. The simulator said the same, to the tenth. Then three things, each
a fraction, found one at a time by writing the number down:

- **The aim** was a prediction: the row's box plus the app's model of the
  scroll view's end, a sum of unrounded terms against a content size the
  layout rounds to the pixel grid, with no rule at all for a transcript shorter
  than its viewport. The view knows its end exactly and now says so —
  `restOffset` on every scroll event, an `onInsetChange` at every rise's start
  and retarget — and the flight aims there and re-aims when the end moves.
  Said one line too early, before the rise was marked as rising, it named the
  old rest and aimed a flight twenty-four points low; said after, exact.
- **The copy's own drawing**: with the aim exact the copy still left a third
  high. The arrival was declared with the squeeze's spring at 1.004, and with
  the scale's origin at the balloon's bottom corner that holds its top a fifth
  of a point high; and the journey's base was a sixth off the grid its layout
  had already been snapped to. The base is on the grid; the copy is put exactly
  at its end when the arrival is declared.
- **The race**: that write goes through the native animation driver and the
  handover's own commit beat it once in twenty-three under two lanes' load. So
  the arrival is judged at half a pixel, not half a point — the spring runs a
  few more frames inside a copy that is visibly still — and the write stays as
  belt to the brace.

The gate pairs the two lines within a frame or two and allows half a point.
Twenty-six of twenty-six. Two more it sets aside and counts: sends made while
the keyboard is animating, where the copy leaves hundreds of points from its
row because the flight layer lives inside the accessory and rides the
keyboard. Older than this week; a layer that does not ride is the fix, and it
is next in this line.

## The springs end where the pixel does (2026-09-21, `13caa212d22`)

"The balloon still slides down its y position a tiny bit." With the aim
exact and the base on the grid, the device's numbers showed one send exact
and one a fifth of a point off, and neither was the slide. The slide was the
squeeze spring's tail: the arrival is declared at 1.002 to 1.004, and with
the scale's origin at the balloon's bottom corner the remaining settle walks
the top edge down a fifth of a point over the last third of a second — one
pixel row, slowly, exactly as described.

So each spring is ended the moment its remaining travel is under half a
pixel and it is barely moving: nothing that small can be drawn as motion,
only as a pixel row flipping at some later frame. Stopped there and set to
its end, the edge is where it will stay, and the arrival finds everything
exact with no write left to race the handover's commit. Two gates were lost
learning how to say that: `setValue` calls the value's listeners
synchronously, so the snap's flag must go up before the write or the
listener recurses to a stack overflow; and `Animated.parallel` stops its
siblings together by default, so a rise ended early read as the whole throw
failing and killed the squeeze mid-way — nine sends that never landed. Each
spring ends on its own now, and a single sending case is checked on the
simulator before the full gate is spent.

## The send's landing, and five ways to be a few points out (2026-09-22, `fe7d0ec8d5f`)

The throw was asked to stop settling — the platform's spring is underdamped
and ours reproduced it faithfully, which a device read three times as the
balloon sliding at the end. Both of its springs are critically damped now, the
position and the swell, at the platform's own Reduce Motion values. Both,
because the overshoot's size scales with what is sent: a spring overshoots a
fraction of its journey, and the swell hangs from the balloon's bottom corner,
so its few per cent move the top edge by that fraction of the whole height.
Recorded on the built app, the reversal is 0.00 at one line, at five lines,
and on a smaller phone.

The check that watches the handover then found five separate faults, and the
order matters less than the shape they share: each was a quantity captured
once and read later as if it had not moved.

- The copy was aimed at where its row would **rest**. True a beat later when
  the send's own rise is all that moves; false while the keyboard's own scroll
  outlasts the flight.
- The row's place in the content was captured at **takeoff**, and a receipt
  opening above it moves every row below by its height.
- The journey was measured from the bar's **top**, and the copy hangs from the
  bar's **bottom** — two edges a composer's height apart, so the error grew
  with the message being typed.
- The instrument read the copy **after it was hidden**, when it had ridden the
  bar for three more frames.
- The arrival's threshold was a **fraction** of the journey rather than a
  distance, so it was half a pixel on a short hop and half a point on the long
  flight an empty chat makes.

Twenty-eight handovers, none more than half a point from its row. What is left
is a send made while the keyboard animates: the aim is re-aimed through a
JavaScript event while the transcript moves three points a frame, so it can be
eight points out at the swap. The check allows twelve there — the measured
worst with a frame of headroom, written down — and the fix is to drive the aim
from the scroll view's own offset natively.

**And the instrument that should have come first.** Four gate runs were spent
guessing which cases produced the failures, because a trace could be
attributed to a case only by counting app launches and indexing into a lane's
list; two of those guesses were wrong. The runner knows the name and now
passes it in. The rule earned: when a check starts failing on a number you
cannot attribute, fix the attribution before the number.

## Both ends of a flight are stated by the views that draw them (2026-09-22)

The note left at the end of the last chapter said the next change was to drive
the flight's aim from the scroll view's offset natively. Measured before it was
written, that was aimed at the smaller of two terms.

The error at the handover is `progress × (row staleness − field staleness)`. It
would be nothing if the two ends were equally behind, because a journey is
their difference and a shared lag cancels. They are not equally behind, because
they do not move at the same rate. A keyboard coming up moves the bar
seventy-nine points in its first frame; the transcript, clamped with nothing to
scroll, does not move at all. So the row's end was exact and the field's end was
seventy-nine points out, and the copy — which hangs from the bar — was carried
up with it and snapped back as the aim caught up: drawn at 508.4, 425.7, 383.5
and then 454.3 on four consecutive frames with its target standing still. That
excursion is what a reader would see. The eight points left at the swap were
its tail.

The mechanism to fix it was already in the tree, which is the part worth
remembering. This app turns on the C++ animated backend, both scroll and dock
payloads already answer `extractValue` for exactly the paths needed, and the
manager's event listener runs inside the dispatch rather than after it — the
comment there says, in as many words, that this is to avoid a frame of latency.
So the same two events now drive two animated values natively: the row's window
position is its place in the content minus an offset the transcript states, and
the field's is an anchor above a bottom edge the bar states. Both are updated
inside the main-thread call that emitted the event, before the frame is drawn.
Nothing predicts, and nothing waits for JavaScript. What JavaScript still owns
is the row's place in the *content*, which is a layout it hears about anyway.

The excursion went from eighty points to thirteen and the handover from eight
to under four, with the still handovers unchanged at a third of a point.

**And what is left is a floor rather than a tolerance.** The copy rides the bar
because at the start of its throw it *is* the field, so wherever it is placed
has to be corrected for where the bar is being drawn — and a bar animated by
UIKit is knowable only from its presentation layer, which is the frame already
on screen. The correction is therefore always for the previous frame, and what
remains is the throw's progress times one frame of the keyboard's travel.
Closing that last frame means modelling the keyboard's curve instead of
measuring it, and a model of someone else's animation is a thing that is right
until the day it is silently wrong. The check holds a moving handover to five
points and says why; a handover with nothing moving — which is what a reader
meets — is still half a point.

