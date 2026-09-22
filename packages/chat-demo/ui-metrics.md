# chat-demo UI metrics

The measured values the demo's constants and checks are based on: what each quantity is,
what it was measured against and how, and which code or check depends on it. Code
comments point here as `See ui-metrics.md, "<Heading>".`

Each entry gives:

- **Value** — the number, with its units.
- **What it is** — which element, which edge to which edge, ink or box, points or
  pixels, from which event to which.
- **Measured** — the reference and the method.
- **Used by** — the constants, functions and checks that depend on it.
- **Notes** — derived relationships and caveats that still hold.

## Reference environment

- **iOS:** the simulator, with a 402 × 874-point window at 3x. The reference is native
  Messages (`com.apple.MobileSMS`), which ships with the iOS runtime and runs in the
  same simulator: the same window size, with no cross-device scaling. iOS 26 and iOS 27
  differ in places (iOS 27's composer has an audio-message button where iOS 26 has
  dictation); entries name the version where it matters.
- **Android:** the emulator, against Google Messages where an entry names it.
- **Defaults.** Unless an entry says otherwise, an iOS reading is native Messages in
  that simulator, and "ours" is the demo read in the same simulator, window and way.
  File names are relative to `packages/chat-demo`: `ChatScreen.js` is
  `screens/ChatScreen.js`, and the `*Check.swift` / `*Shot.swift` UI tests are in
  `ios/uitests/Sources/`.
- Distances are in points, with y measured from the window's top, unless an entry says
  otherwise. Pixel counts are device pixels at 3x (px @3x); Android figures are in dp,
  or in px where the source recorded px. Animation and event timings are in ms, frame
  rates in fps. Colours are 8-bit components sampled from screenshots. Light mode unless
  an entry says dark.

## How values are measured

- **A real message, sent to yourself.** Messages will send to itself over SMS on the
  simulator, which is the only way to get a real balloon, a real tail and a real receipt
  to measure. Open the first conversation, tap the field, type with `idb ui text`, then
  tap the send arrow (it sits at about `(360, 504)` with the keyboard up). Writing rows
  into its database from outside does not work: the schema's triggers call functions
  only the app itself registers. Messages will not deliver a message to itself, so there
  is no received balloon to sample; see "Received balloon grey" for where that colour
  comes from.
- **Ink, not image size.** A screenshot measures ink, and a symbol's image size is not
  its ink. `tools/symbol-ink.m` renders an SF Symbol at a given point size, weight and
  scale and prints both; its header has the build and run commands. A symbol's
  configuration (the `+`) is found by rendering candidates until the ink matches what
  native Messages draws, not by estimating.
- **`tools/composer-diff.py`** opens both apps on the booted simulator, brings each
  composer up, and prints a table of landmarks in points with the difference between
  them (commands in the README).
- **Raise the keyboard before believing anything.** Messages' docked composer is a
  different layout from its raised one, and the two are not interchangeable. Composer
  values are for the raised composer unless an entry says docked.
- **The rule, not the reading.** A value that reads like the answer may be one branch of
  a rule: the balloon's maximum width reads as a percentage, 0.85, which is only the
  no-`+`-button branch of Messages' width rule. Where a rule can be called, call it
  across widths, and confirm against a real balloon. See "Balloon max width".
- **Like for like.** Compare transcripts of the same shape: a two-message conversation
  cannot scroll, so it says nothing about a long one.
- **Motion** is measured from screen captures (60 fps unless an entry says otherwise),
  sampling ink frame by frame.
- **Assets that are not symbols.** On iOS 27 the runtime lives in a cryptex and ChatKit
  has no Mach-O left to read, but its `Assets.car` is still a file and
  `assetutil --info` reads it. That is where the audio-message glyph's shape and
  proportions (`AUDIO_BARS`) come from.
- **Platform behaviour Messages cannot show** is measured with small apps built from
  stock UIKit controls. They are not in this repo.
- **The simulator's software keyboard** must be on (I/O > Keyboard > Toggle Software
  Keyboard). A reboot turns it off, and keyboard behaviour then looks device-only.

## Contents

- [Balloon](#balloon) (7)
- [Balloon tail](#balloon-tail) (1)
- [Receipt](#receipt) (9)
- [Date separator](#date-separator) (3)
- [Typing indicator](#typing-indicator) (2)
- [Reactions](#reactions) (5)
- [Send animation](#send-animation) (6)
- [Transcript & scrolling](#transcript--scrolling) (7)
- [Timestamp reveal](#timestamp-reveal) (3)
- [Composer](#composer) (16)
- [Composer `+` button](#composer--button) (3)
- [Keyboard & safe area](#keyboard--safe-area) (4)
- [Header](#header) (1)
- [Colors & materials](#colors--materials) (8)
- [Android](#android) (6)
- [Performance](#performance) (8)

## Balloon

### Balloon max width

- **Value:** column − 89.333 pt with a `+` button in the composer (280.667 pt with 16 pt
  margins); 85% of the column without one (314.5 pt).
- **What it is:** the widest a message balloon can be.
- **Measured:** Messages' width rule, called with the transcript's numbers (width 402,
  insets 16, plugin buttons YES, character count NO, cover the send button NO), returns
  280.6667, and the same reserve at widths 320–440 pt with margins of 16 pt or more. A
  sent balloon of fifty narrow glyphs measures 280.667 pt.
- **Used by:** `BALLOON_PLUS_RESERVE`, `balloonMetrics` (`maxWidth`) in `ChatScreen.js`;
  `WrapCheck.swift`.
- **Notes:** 85% of the window (341.7 pt) is about 60 pt wider than any native balloon.
  Below a 16 pt margin the reserve grows by what the margin is short of 14 (the demo
  doesn't use that case). The reserve keeps the balloon's text column (c − 16 − 16 −
  89.333 − 28 = c − 149.333) within a sixth of a point of the field's (c − 16 − 16 − 40
  − 12 − 16 − 5 − 38 − 6.5 = c − 149.5; see "Text column: composer field vs balloon"),
  at every width, so text doesn't re-wrap on send. `WrapCheck` checks both sums at the
  gate's width.

### Balloon max width in wide columns

- **Value:** `min(column − 89.333, 0.85 × column)`; the branches cross at a 595.56 pt
  column. Portrait (370 pt column): 314.5 vs 280.667, so the reserve applies. Landscape
  (718 pt column): 610.30 vs 628.67, so 85% applies; native Messages' balloon there is
  608.33, one narrow glyph short, like any wrapped balloon.
- **What it is:** the widest a balloon can be for a given transcript column (the width
  inside the safe area and the 16 pt margins).
- **Measured:** Messages' width rule at columns of 320–932 pt; a native landscape
  balloon.
- **Used by:** `BALLOON_MAX_WIDTH` on `styles.balloonWrap` (the 85% branch,
  `balloonMaxWidthPercent`) and `BALLOON_PLUS_RESERVE` via `balloonMetrics` in
  `ChatScreen.js`, as nested `maxWidth`s, which combine as the minimum;
  `BalloonShapeCheck.swift`, `WrapCheck.swift` (portrait).

### Balloon minimum width

- **Value:** 48.00 pt (the balloon is 48.00 × 46.67 pt).
- **What it is:** the narrowest a balloon is drawn. A one-character message and a "."
  measure the same, so it is a floor.
- **Measured:** a sent balloon at 3x.
- **Used by:** `BUBBLE_MIN_WIDTH`, `styles.bubble` (`minWidth`) in `ChatScreen.js`;
  `testAOneCharacterBalloonKeepsThePlatformsMinimumWidth` in `BalloonShapeCheck.swift`.
- **Notes:** at this width the tail's span, `min(22, w − r)`, is never clamped. Below
  about 40 pt it is, and the outline overshoots and notches the bottom edge.

### Wrapped balloon width

- **Value:** 269.26, 256.26 and 252.62 pt for three seeded wrapped messages, under a
  280.67 pt limit.
- **What it is:** a wrapped message's balloon width: it fits its longest line.
- **Measured:** native Messages with the same messages.
- **Used by:** `experimental_hugsWrappedLines` on `styles.bubbleText` in
  `ChatScreen.js`; `testAWrappedBalloonHugsItsLongestLine` in `BalloonShapeCheck.swift`,
  which checks the text run (the balloon less 14 pt padding each side): 241.3 pt for
  "Did the keyboard cover the last message?" and 224.6 pt for "The bar follows the
  keyboard rather than copying it." (native 241.26 and 224.62), ±1 pt.
- **Notes:** plain shrink-to-fit stops at `min(max-content, max-width)`, so without
  `experimental_hugsWrappedLines` every wrapped balloon is 280.67 wide.

### Balloon text inset

- **Value:** 14 pt horizontally, 10 pt vertically, from the balloon's edge to its text
  box. A one-line balloon is 40 pt tall around 17 pt text, with the cap top 14 pt below
  its top and the baseline 14 pt above its bottom.
- **What it is:** where a message's text sits inside its balloon.
- **Measured:** the native balloon's mask alignment insets,
  `{top 10, left 14, bottom 16.83, right 14}` (the bottom's extra 6.83 is the tail). The
  vertical 10 is the text container inset `{10, 0, 10, 0}`, derived from the composer
  field's vertical inset times the text-size factor (1.0, or 1.2 at accessibility
  sizes), so balloon and field are padded alike; a 5 pt line fragment padding applies on
  both sides on top.
- **Used by:** `BUBBLE_PADDING`, `BUBBLE_PADDING_V`, `styles.bubble` in `ChatScreen.js`.
  `BalloonShapeCheck.swift`, `WrapCheck.swift`, `MaterialCheck.swift` and
  `ReceiptCheck.swift` derive the balloon from the text run (+14 pt each side, +10 above
  and below); `MaterialCheck` samples the 12 pt left of the run, and the balloon's side
  is straight from 10 pt below the run's top to 10 pt above its bottom.
- **Notes:** the tail takes no width, so both sides have the same inset.
  **Unreconciled:** where the first glyph's ink starts. One reading gives 16 pt (14 of
  padding plus the glyph's side bearing, window not recorded); with an "M" first it is
  14.33 pt. Halving the spare width of a one-word balloon (47.33 pt around 13.33 pt of
  ink) also gives 16, but ignores the minimum width.

### Message line height

- **Value:** the line box is the type size + 3 pt at every text size
  (`MESSAGE_LEADING`); 17 pt type by default (`MESSAGE_FONT_SIZE`).
- **What it is:** the baseline-to-baseline pitch of a balloon's lines.
- **Measured:** twelve gaps in a thirteen-line native balloon: 20.000 at 17 pt, 22.028
  at 19, 24.000 at 21, where the font's own line height is 20.2871, 22.67 and 25.06.
  Balloons follow `2 × BUBBLE_PADDING_V + lineBox × lines`: 40.00, 60.00 and 240.00 pt
  for one, two and eleven lines, and 44.00 pt for one line at XXL.
- **Used by:** `MESSAGE_LEADING`, `MESSAGE_FONT_SIZE`, `balloonMetrics` in
  `ChatScreen.js`; `testATwoLineBalloonIsTwoLineBoxesAndItsPadding` in
  `BalloonShapeCheck.swift` (a two-line run is 40.0 ± 0.5 pt; at the font's line height
  it would be 40.57); `lineBox` (20) in `WrapCheck.swift`.
- **Notes:** the corner radius is half the one-line height, so it follows the font. The
  composer uses the font's line height ("Composer line box").

### Message truncation

- **Value:** over 6,000 characters, a balloon shows a 240-character preview.
- **What it is:** the length that triggers a preview, and the preview's length.
- **Measured:** 4,000 characters render in full (far more than six lines), 8,000
  truncate; 6,000 is the midpoint. The native preview is about six lines of about forty
  characters.
- **Used by:** `TRUNCATE_ABOVE`, `TRUNCATE_PREVIEW` in `ChatScreen.js` (`BubbleImpl`'s
  `tooLong`, `FlyingBalloon`).
- **Notes:** the trigger is length, not lines; the renderer has no line clamp.

## Balloon tail

### Balloon tail reserve

- **Value:** a tailed balloon's box is `CHAT_BUBBLE_TAIL_DROP` (6.65 pt) taller than a
  tailless one; the body doesn't change. Native: 140 → 119 px @3x, 7 pt. A native
  one-line body ends at y = 299 and its tail's point is at y = 306, 7.5 pt inside the
  body's trailing edge.
- **What it is:** the bottom padding a tailed balloon reserves for its tail. The body is
  box height − tail amount × reserve.
- **Measured:** the demo's balloon traced through a tail-retract animation: `h` 47.0,
  45.3, 41.4, 40.3 at `tail` 1.00, 0.74, 0.16, 0.00, `body` 40.3 throughout. Native
  Messages shows the same relationship.
- **Used by:** `CHAT_BUBBLE_TAIL_DROP` in `expo-intrinsics/src/chatBubbleMetrics.js`;
  `NativeChatBubble` (the tail takes no width); `__tests__/tailReserve-test.js`;
  `ReceiptCheck.swift`.
- **Notes:** the tail doesn't extend sideways; the edge above it curves more than 9 pt
  inward before curving out to the point. During a send an older row moves about 22 pt
  natively and about 5.3 pt in the demo, with no balloon body changing size (compare on
  a transcript long enough to scroll). **Unreconciled:** the native drop reads 7 pt
  here, 6.83 pt from the mask insets ("Balloon text inset") and 6.00 pt in "Reaction run
  grouping"; the sources don't say which 6.65 follows.

## Receipt

### Receipt text size

- **Value:** 11 pt; ink 7.67 pt tall (an 11 pt cap height). Colour `#3C3C43` at 60%
  alpha (`secondaryLabel`).
- **What it is:** the receipt's type size and colour.
- **Measured:** 393 pt window.
- **Used by:** `styles.receipt` in `ChatScreen.js`.

### Receipt line height

- **Value:** 13 pt.
- **What it is:** one line of the receipt's 11 pt text at the default text size: the
  height its space opens to.
- **Measured:** this renderer's css-trace on iOS (`h auto->13.000px`).
- **Used by:** `RECEIPT_LINE_SEED`, until `measuredReceiptLine` replaces it at runtime
  (it differs under Dynamic Type).

### Receipt trailing inset

- **Value:** 19.667 pt.
- **What it is:** how far the receipt's trailing edge is inside the transcript's
  trailing margin. The receipt is right-aligned there whatever its balloon's width.
- **Measured:** the native receipt is right-aligned; under a two-line balloon and under
  "Hi" its ink ends at x = 365.0. Ours matches: 50 pt of ink ending 37.0 pt from the
  window's edge.
- **Used by:** `RECEIPT_INSET`, `styles.receipt` (`marginRight`) in `ChatScreen.js`.

### Receipt vertical position

- **Value:** native, under a two-line message: the receipt's ink starts 8.00 pt below
  the balloon's body and 1.33 pt below the tail's tip. Ours: the receipt's box starts
  5.65 pt below the body, which puts the ink at 8.00. These measure different things:
  5.65 is the box's top, 8.00 the ink's; an 11 pt line box has about 2.35 pt of leading
  above its ascenders.
- **What it is:** the gap from the balloon's body (and tail tip) to the receipt below
  it.
- **Measured:** a sent balloon, same window, message and threshold for ours.
  `ReceiptCheck` computes ours from the text: body bottom = text bottom +
  `BUBBLE_PADDING_V` (10); box top = that + tail drop (6.65) + `marginTop` (−1).
- **Used by:** `styles.receipt` (`marginTop: -1 + RECEIPT_AIR`), `RECEIPT_AIR`,
  `Receipt` in `ChatScreen.js`; `testTheReceiptSitsAgainstTheBalloon` in
  `ReceiptCheck.swift` (box top 5.65 ± 1.5 pt).
- **Notes:** without a drawn tail, `RECEIPT_AIR` adds the tail's drop plus 3 pt (a gap
  looks smaller under a flat edge), to both the margin and the box: on Android, moving
  the ink without growing the box left 2.67 pt of an 8 pt line showing. A wrapper box
  around the text moves the box's top to 7.42 pt, so the text element carries the
  transition and `receiptSpace` is the only box. **Unreconciled:** the gap under the
  tail's tip is 1.33 pt above; `RECEIPT_AIR`'s comment says 2.3 pt, with no method or
  reference edge.

### Receipt arrival

- **Value:** the ink scales from 0.21 over 610 ms on `cubic-bezier(0.25, 1, 0.5, 1)`,
  about its centre; its opacity rises over eight frames (`RECEIPT_FADE_MS`, 133 ms).
- **What it is:** `Delivered` appearing under a sent balloon.
- **Measured:** the ink's box, one threshold for all frames; `Delivered` settles at
  50.00 × 8.67 pt, its centre fixed at x 219.5 while top and bottom each move 11 px.
  Duration, start scale and curve fitted together over 23 frames: worst residual 0.125
  pt. Peak brightness goes 162 → 130 over the eight frames.
- **Used by:** `RECEIPT_GROW_MS`, `RECEIPT_FADE_MS`, `RECEIPT_GROW_CURVE` in
  `receiptTiming.js`; `RECEIPT_GROW`, `RECEIPT_FADE`, `RECEIPT_GROW_FROM` in
  `ChatScreen.js`.
- **Notes:** fit the three values together; a first-to-last-frame ratio gives a
  different duration and scale. This curve fits four times better than CSS `ease-out`
  (of nine compared); at 250 ms the native receipt is at 0.91 of its size. The opacity
  uses `ease-out`, not fitted.

### Previous receipt through a send

- **Value:** 1130 ms (`DELIVERED_AFTER`) from sending a message to its `Delivered`;
  until then the previous message's receipt stays fully drawn.
- **What it is:** how long the last receipt (e.g. "Read 8:53 PM") stays after a new
  send. The transcript always shows a receipt.
- **Measured:** the old receipt is still fully drawn 68 frames after the send; the new
  `Delivered` appears over the next four.
- **Used by:** `DELIVERED_AFTER`, `deliveredAfter`, `lastSent`, `wearsReceipt`,
  `previousWearer` in `ChatScreen.js`; `ReceiptHandoffCheck.swift` (lengthens it with
  `EXP_DELIVERED_AFTER_MS`).
- **Notes:** a new message takes the receipt only once it has a status, including across
  two sends inside the delay. Natively the delay is the server's response; the demo uses
  a timer.

### Receipt handover

- **Value:** the old receipt's ink is gone about 100 ms after it starts fading; the new
  one appears about 250 ms later. No cross-fade.
- **What it is:** the receipt moving to a newer message: the old ink's fade (opacity
  only, full size), then the gap before the new ink.
- **Measured:** ink pixels in the old `Read 4:13 PM` row: 154 at t = 2530 ms, 121 at
  2580, 0 at 2630; the new receipt at t = 2880.
- **Used by:** `RECEIPT_LEAVE_MS` (100), `RECEIPT_HANDOVER_GAP_MS` (250),
  `RECEIPT_INK_DELAY_MS` (their sum) in `receiptTiming.js`; `styles.receiptInkLeaving`,
  `styles.receiptSpaceLeaving`, `styles.receiptInkShown` in `ChatScreen.js`;
  `__tests__/receiptTiming-test.js`.
- **Notes:** the fade is shorter than `RECEIPT_LAYOUT_MS`, so the words are gone before
  their row closes.

### Receipt word swap

- **Value:** out over 10 frames, nothing for 6, in over 13: `RECEIPT_SWAP_OUT_MS` 175,
  `RECEIPT_SWAP_GAP_MS` 100, `RECEIPT_SWAP_IN_MS` 217.
- **What it is:** `Delivered` changing to `Read 5:29 PM` under the same message; opacity
  only, no change in width, trailing edge or height.
- **Measured:** the ink's peak brightness per frame. Counting pixels over a threshold
  reads 5, 14 and 10 frames instead, because fading pixels drop under the threshold
  early.
- **Used by:** `RECEIPT_SWAP_OUT_MS`, `RECEIPT_SWAP_GAP_MS`, `RECEIPT_SWAP_IN_MS`,
  `RECEIPT_SWAP_AT_MS` in `receiptTiming.js`; `styles.receiptInkFading`,
  `styles.receiptInkSwapped` in `ChatScreen.js`.

### Delivered to Read interval

- **Value:** 3496, 3597 and 3681 ms over three runs; the check allows 2900–4300 ms.
- **What it is:** the demo's time from a `Delivered` label first appearing in the
  accessibility tree to a `Read …` label, polled every 20 ms. A label is in the tree
  before its ink is drawn and leaves before its ink does, so first sightings are
  compared.
- **Measured:** by the check (`MEASURE delivered-to-read`), with `RECEIPT_HOLD_MS` as a
  minimum time on screen after the ink settles.
- **Used by:** `testTheReaderGetsAMomentBetweenDeliveredAndRead` in
  `ReceiptCheck.swift`; `RECEIPT_SETTLED_MS`, `RECEIPT_HOLD_MS`, `RECEIPT_SWAP_AT_MS` in
  `receiptTiming.js`; `settled` in `ChatScreen.js`.
- **Notes:** `simctl io recordVideo` gets about 15–23 fps while the app loads ten
  thousand rows, so its edges are good to about 50 ms.

## Date separator

### Date separator text size

- **Value:** 11 pt (Caption2); "Today 3:25 AM" is 10.0 pt from cap top to descender.
- **What it is:** the separator's type size.
- **Measured:** the native text attributes, checked on a real separator.
- **Used by:** `styles.stamp` in `ChatScreen.js`.

### Date separator weights

- **Value:** stems: "Today" 1.0 pt, the time 0.67–1.0 pt (semibold would be 1.24); the
  receipt's `Delivered` 1.33 pt against SF Regular's 0.96.
- **What it is:** stem widths that identify the weights: the day medium (500) and the
  time regular; the receipt's word SF Semibold 11 (600) and its time SF Regular 11.
- **Measured:** a native separator and receipt.
- **Used by:** `styles.stampDay`, `styles.receiptStatus` in `ChatScreen.js`;
  `testTheReaderGetsAMomentBetweenDeliveredAndRead` in `ReceiptCheck.swift` waits for the
  `Read` line with its time (a UI test can't see a font).

### Date separator arrival

- **Value:** a 270 ms opacity fade; nothing moves.
- **What it is:** the separator's ink fading in above a thread's first message, from the
  start of the send.
- **Measured:** "Today 2:20 PM" per frame: 255 → 161 over 270 ms, done before the
  balloon's flight ends.
- **Used by:** `STAMP_FADE`, `styles.stampShown`, `Stamp` in `ChatScreen.js`.

## Typing indicator

### Typing indicator

- **Value:** dots 8.5 pt, corner 4.25, black at opacity 0.2, three instances 12.5 pt
  apart (`instanceDelay` 0.25 s); each dot animates opacity 0.2 → 0.45 over 0.5 s,
  autoreversing and repeating, on `bezier(0.75673, 0.015306, 0.58, 1)`; the container
  pulses `scale [1, 1.03, 1]` over 1.9 s, ease-in-out. Size 78.5 × 35 pt; large bubble
  57.5 × 35 (holds the dots) offset (14, −28.5); medium bubble 11.5 × 11.5 offset (7,
  −7.5); small bubble frame `{2, 38, 5, 5}`; the large bubble grows from begin time 0.12
  s. Background sRGB 0.915294 0.915294 0.920314 (light).
- **What it is:** the native typing indicator's geometry (points) and timing (seconds,
  as the layers state them).
- **Measured:** the native indicator's layers and their `CAAnimation`s.
- **Used by:** `TYPING_DOT`, `TYPING_DOT_GAP`, `TYPING_BEAT`, `TYPING_STAGGER`,
  `TYPING_BEAT_FRAMES`, `TYPING_GROW_DELAY`, `TYPING_BUBBLE_W`, `TYPING_BUBBLE_H`,
  `TYPING_MEDIUM`, `TYPING_SMALL`, `TYPING_PULSE`, `TYPING_BREATH_FRAMES`,
  `TypingIndicator`, `typing*` / `dot` styles in `ChatScreen.js`.
- **Notes:** 35 pt tall where a message balloon's padding gives 28.5. The grow's 260 ms
  and curve are chosen: nothing publishes them, and the simulator can't show a native
  typing indicator.

### Typing dot colour

- **Value:** black at opacity 0.2, about (187, 187, 188) over the received grey.
- **What it is:** a typing dot's fill at rest.
- **Measured:** the native layer properties.
- **Used by:** `styles.dot` (`uiColor('label')`, `opacity: 0.2`), `TYPING_BEAT_FRAMES`
  in `ChatScreen.js`.
- **Notes:** the native dot turns white in dark mode, as `label` does.

## Reactions

### Reaction badge placement

- **Value:** a 36 × 36 pt badge with a 34 pt disc (1 pt mask inset). The disc's centre
  is 10.5 pt above the balloon's top and 2.5 pt inside its side edge, on the side away
  from the tail. On a sent balloon it is `#0088FF`, the gradient's bottom stop.
- **What it is:** the badge for a message with one reaction, overlapping the balloon's
  corner.
- **Measured:** a sent balloon.
- **Used by:** `BADGE`, `BADGE_FILL`, `styles.badgeAnchor`, `styles.badgeMine`,
  `styles.badgeTheirs` in `ChatScreen.js`; `testEveryGlyphLeavesABadgeOfTheRightSize` in
  `ReactionShot.swift` (34 ± 1 pt).
- **Notes:** the badge is the balloon's sibling, so the context menu lifts the balloon
  without it.

### Reaction badge tail circles

- **Value:** intermediate 16 × 15 pt, centred 8.3 pt out and 15 pt down from the disc's
  centre, joined to the disc; anchor 8 × 7 pt, 16.2 pt out and 22 pt down, separate.
- **What it is:** the badge's two tail circles; "out" is away from the balloon.
- **Measured:** sizes from native Messages; positions from a capture.
- **Used by:** `BADGE_INTERMEDIATE_W`/`_H`, `BADGE_ANCHOR_W`/`_H`,
  `styles.badgeIntermediate*`, `styles.badgeAnchorDot*` in `ChatScreen.js`.

### Reaction badge glyphs

- **Value:** white on the badge, except the heart: pink, shaded light to deep (the demo
  uses a flat `#FF8AB8`, the midtone). Ha: "HA HA" on two staggered lines; exclamation
  "!!"; question "?"; thumbs: a solid 3D thumb. The picker colours them instead (gold
  thumbs, blue "HA HA", red "!!", purple "?"), so it is no reference for the badge.
- **What it is:** each reaction's glyph inside the badge.
- **Measured:** iOS 26, each reaction captured on its own.
- **Used by:** `REACTIONS[].art` in `reactions.js`; `ReactionArt` in `ChatScreen.js`.
- **Notes:** the heart's gradient is Apple artwork that neither a font nor a tinted
  symbol reproduces; the `♥` glyph at 20 pt is narrower and more pointed.

### Reaction pile

- **Value:** a 46 × 40 pt container (36 pt for one badge); each disc behind the front
  one shows about 3 pt.
- **What it is:** the badge for two or more reactions: a front disc with the newest
  glyph and one or two discs behind it, offset horizontally away from the tail, never
  upward.
- **Measured:** container: native Messages' sizes. Offset: the native stacked artwork,
  scanned by row, is 35.7 pt wide with one disc behind and 38.7 pt with two, the front
  disc about 34 pt, both on rows y 1..33.
- **Used by:** `PILE_PEEK`, `ReactionPile`, `styles.pileBehind`, the `react-others`
  action in `ChatScreen.js`.
- **Notes:** the demo's choices: an emoji on the front disc where a large real pile may
  show a count, and at most three discs.

### Reaction run grouping

- **Value:** the message before a reacted one ends its run and gets a tail (40.00 →
  46.00 pt), in two- and three-message runs. A reacted middle message stays 40.00 pt,
  tailless, 4.33 pt from the next (still grouped). The gap above a reacted balloon is
  the 4.33 pt run spacing if the balloon above ends 30 pt further right, 32.00 pt if
  they share a column.
- **What it is:** sent balloons' heights and gaps in a run with a reaction.
- **Measured:** sent balloons only (all the harness can produce).
- **Used by:** `runFlags`, `isReactedTo` in `runGrouping.js`;
  `__tests__/runGrouping-test.js` (one case per rule).
- **Notes:** unmeasured for received messages, so `startsRun` ignores reactions; the
  extra gap is geometry (would the badge hit the balloon above), so `separatesRun`
  ignores them too. **Unreconciled:** the source calls the growth "the tail's 6.667",
  but the heights differ by 6.00 pt.

## Send animation

### Send trajectory

- **Value:** the sent balloon's width and top per frame, from its first frame (ms:
  width, top): 0: 318, 483; 32: 288, 483; 63: 254, 473; 95: 202, 438; 112: 180, 419;
  145: 146, 375; 177: 136, 338; 210: 136, 303; 277: 150, 253; 345: 164, 231; 412: 172,
  224 (highest); 463: 176, 224; 568: 178, 230; 745: 176, 233 (rest). The rise is a
  `CASpringAnimation`, mass 1, stiffness 141.75909, damping 17.35028 (23.8125 under
  Reduce Motion), `beginTime + 0.055`, duration `settlingDuration`, from
  `initialPositionY` to `finalPositionY`.
- **What it is:** the native send animation.
- **Measured:** an empty conversation, so the balloon travels 250 pt in view.
- **Used by:** `THROW_SPRING`, `THROW_DELAY`, `SQUASH_*`, `SWELL_SPRING`,
  `FlyingBalloon` in `ChatScreen.js`; `onFieldSize` in `Composer.js`;
  `SendMorphCheck.swift`.
- **Notes:**
  - It starts as the field: 318 × 46, the pill with the message in it. The width dips to
    136 (0.77 of the final 176) and springs back. The trailing edge stays at x 376.7
    throughout; the native `position.x` animation only follows the width.
  - The top overshoots to 224 and rests 9 pt lower: a damping ratio of 0.73, first peak
    at π/ω_d = 385 ms with 3.5% overshoot; measured, the peak is at 412–463 ms and the
    overshoot 9/259 = 3.5%. The overshoot scales with the distance: about 2 pt for a
    one-line send (about 60 pt), 6 for five lines. The demo uses the Reduce Motion
    damping, critical for this mass and stiffness, so it doesn't overshoot. The demo's
    animation takes 667 ms end to end.
  - Two more captures: 288 × 32 at t = 0, 224 × 44 at 103 ms, 80 × 34 at 205 ms
    (narrowest), 104 × 44 at 422 ms (6 pt above rest), 106 × 46 at 473 ms, trailing edge
    fixed at x 384; and a third that starts 317 × 65, the field's whole box (y 464–528),
    narrows to 203 and settles at 261 wide. The native balloon is drawn over the
    composer, hiding the field's collapse.

### Send squash

- **Value:** 177 ms on `cubic-bezier(0.41, 0.2, 0.6, 1)`; the trough is 0.77 of the rest
  size for a one-line composer.
- **What it is:** the sent balloon narrowing from the field's width (318 pt) to its
  trough (136 pt).
- **Measured:** the frames in "Send trajectory", fitted over cubic-beziers (worst
  residual 3% of the travel).
- **Used by:** `SQUASH_DURATION`, `SQUASH`, `SQUASH_TROUGH`, `squashTrough` in
  `ChatScreen.js`; `SendMorphCheck.swift`.
- **Notes:** the native trough is `0.7 + 0.2 × clamp((h − H) / (7H − H), 0, 1)`, H the
  one-line composer height; measured one-line troughs are 0.77, not 0.70, because the
  scale-up spring starts before the scale-down settles. A six-line message bottoms out
  at 232 of 280 pt (0.83; `squashTrough` gives 0.835). The dip is in both axes: 43.33 ×
  35.67 pt against 56.67 × 47.00 at rest.

### Send swell

- **Value:** mass 2, stiffness 320, damping 38 (50.5964 under Reduce Motion, critical).
- **What it is:** the native spring that scales the balloon back up from its trough.
- **Measured:** first peak at 376 ms with 2.8% overshoot; on frames the width peaks at
  178 pt against 176 (1.1%), 350–450 ms after the trough.
- **Used by:** `SWELL_SPRING` in `ChatScreen.js` (the Reduce Motion damping).
- **Notes:** the composer's matching scale-down uses stiffness 310. The scale is
  anchored at the balloon's trailing bottom corner, so overshoot moves the top edge:
  about 1.5 pt for one line, 4 for five.

### Send end-state model

- **Value:** on 10,000 messages the model and the scroll view agree to a thousandth of a
  point: measured 600954.9791666666, modelled 600954.98, settled 600955.0 (content
  offset). The scroll view reports the new `restOffset` 6 ms after the sent row is
  measured (aimed at t = 1878 ms, rise at t = 1884 ms).
- **What it is:** `endOfFlight`'s prediction of the resting content offset after a send
  (pill back to its empty height, content grown to the new row plus `ROW_AIR` and
  `TRANSCRIPT_BOTTOM_PAD`, scrolled to the end), against `restOffset`.
- **Measured:** the app's trace on a device.
- **Used by:** `endOfFlight` in `ChatScreen.js`: `max(restOffset, modelled)`.
- **Notes:** a new row only increases the rest offset, so a stale `restOffset` is too
  small and `max` discards it; this holds only because the model never overshoots. The
  rise grows with the transcript: 24 of 64.67 pt at three messages, 56.7 of 64.65 pt
  when full.

### Native balloon lift during the receipt handover

- **Value:** native 18 pt over 16 frames; demo 14 pt over about 300 ms.
- **What it is:** a sent balloon moving up just after its animation, while the receipt
  moves to it: the column moves as the previous receipt's space closes.
- **Measured:** a native recording; the demo after the animation, where the balloon
  rests within a point of its computed position.
- **Used by:** no code pointer. `endOfFlight`'s prediction leaves the lift out; the
  flying balloon's target, `trackY` in `ChatScreen.js`, follows the row's current
  position, so the row carries the lift as in native Messages.

### Send handover during a keyboard move

- **Value:** 3.8, 4.5 and 5.8 pt in three runs; the gate allows 8 pt during a keyboard
  move, 0.5 pt otherwise.
- **What it is:** when the flying balloon is replaced by the row's balloon, the vertical
  distance between them (`winY` to `winY`), within 500 ms of a keyboard height change.
- **Measured:** the app's trace (`flier drawn at`, `balloon#N gone[flier] winY=`,
  `row R balloon shown winY=`).
- **Used by:** the handover check in `tools/gate.sh` (`d>8.0`, `d>0.5`).
- **Notes:** the error is `progress` × one frame of keyboard travel, because a bar UIKit
  animates can only be read from its presentation layer. The keyboard moves 86 pt in its
  first frame and under 1 pt in its last. The flying balloon strays at most 13 pt from
  its path here; the faults this catches are 20–80 pt.

## Transcript & scrolling

### Transcript side margin

- **Value:** 16 pt from the column's edge (the safe-area edge) to a balloon. Ours on the
  402 pt window: 16 pt upright, 78.33 pt in landscape (the 62 pt sensor-housing safe
  area plus 16).
- **What it is:** the transcript's side margin.
- **Measured:** 393 pt window: a received balloon's left edge at x 16.0, a sent
  balloon's right edge at 376.7 (16.3 from the right). In landscape a sent balloon ends
  at 795.67 on an 874 pt screen.
- **Used by:** `TRANSCRIPT_MARGIN`, `styles.row` (`paddingHorizontal`),
  `styles.transcriptContent` (safe-area padding) in `ChatScreen.js`;
  `COMPOSER_MARGIN_TRAILING` in `Composer.js`; `RotationCheck.swift`, which checks that
  both sides are equal and that the landscape margin is more than 20 pt larger (the safe
  area varies by device).
- **Notes:** must equal the composer's trailing margin ("Composer side margins").

### Transcript end padding

- **Value:** 15.667 pt above the first message; 16 pt below the last.
- **What it is:** the transcript content's top and bottom padding.
- **Measured:** native Messages (method not recorded).
- **Used by:** `styles.transcriptContent` (`paddingTop`), `TRANSCRIPT_BOTTOM_PAD`
  (`paddingBottom`, also in `endOfFlight`) in `ChatScreen.js`.

### Gap between rows in a run

- **Value:** 4 pt (12 px @3x).
- **What it is:** the gap between consecutive balloons from one sender.
- **Measured:** a 3x screenshot.
- **Used by:** `ROW_AIR` (2 pt above and below each row), `styles.row`,
  `styles.rowEndsRunLeaving` in `ChatScreen.js`.
- **Notes:** a run's last row has `rowEndsRun`'s `paddingBottom: 8` instead.

### Avatar size and position

- **Value:** a 24 pt circle at x 16..40 on a 393 pt window, 7 pt from its balloon,
  aligned with the run's last balloon's bottom.
- **What it is:** a group sender's avatar; the gap is the native contact-photo margin.
- **Measured:** a native group thread.
- **Used by:** `AVATAR`, `CONTACT_PHOTO_MARGIN`, `styles.avatar`, `styles.avatarSpacer`
  in `ChatScreen.js`.

### Sender name text size

- **Value:** 11 pt, SF Regular.
- **What it is:** the sender's name above a received run.
- **Measured:** the native label's font, read at runtime.
- **Used by:** `styles.sender` in `ChatScreen.js`.

### Offset intents per transaction

- **Value:** at most 3 (`MAX_OFFSET_INTENTS`); two are normal when the second is a real
  re-evaluation, e.g. the bar settling from 68.0 to 68.7 pt.
- **What it is:** offset writes in one mounting transaction (the highest `#N` on a
  scroll-view `write` trace line).
- **Measured:** the app's trace across the UI suite.
- **Used by:** the offset-intents check in `tools/gate.sh`.

### Scroll view inset report latency

- **Value:** within 25 ms; the gate allows 500 ms.
- **What it is:** from a bar being hosted (`accessory#N hosted in`) to the scroll view
  logging a nonzero `kbInset`.
- **Measured:** the app's trace.
- **Used by:** the hosted-bar check in `tools/gate.sh`.

## Timestamp reveal

### Timestamp reveal travel

- **Value:** 56 pt (a sent balloon's trailing edge moves from x 371 to 315).
- **What it is:** how far a full-width leftward drag moves the transcript to show the
  times. It gets there before the finger stops and stays.
- **Measured:** a three-second drag across the screen (360 pt of finger), trailing edge
  tracked per frame. Screenshots mid-drag read less (20 pt of finger → 16 pt, 40 → 20,
  161 → 39) and aren't used.
- **Used by:** `REVEAL_LIMIT` (66), `REVEAL_SETTLED` (56), `resistedReveal` in
  `reveal.js`; `__tests__/resistedReveal-test.js` (`resistedReveal(360)` within 54–58
  pt); `settled` in `ReactionCheck.swift`; `RevealShot.swift` (56 pt for about 370 pt of
  finger).
- **Notes:** `REVEAL_LIMIT` is fitted to this reading (`resistedReveal(360)` = 55.8).
  Native Messages stops at its travel; `resistedReveal` only approaches the limit.
  **Unreconciled:** the capture in "Timestamp reveal ink curve" settles at 58 pt; the
  curve uses fractions of each capture's travel, so it doesn't depend on which is right.

### Timestamp reveal column

- **Value:** `REVEAL_COLUMN` 54 pt + `REVEAL_COLUMN_LANDING` 2 pt = `REVEAL_SETTLED` 56
  pt. Every time ends 16 pt from the screen's trailing edge ("11:04 PM" and "3:41 PM"
  end at the same x).
- **What it is:** the width of the revealed times' column, sized for the longest time
  ("10:38 PM" is about 50 pt at 11 pt), and where the times end.
- **Measured:** screenshots; two-digit hours keep the same 16 pt inset.
- **Used by:** `REVEAL_COLUMN`, `REVEAL_COLUMN_LANDING`, `REVEAL_SETTLED`, `revealGap`
  in `reveal.js`; `REVEAL_BOX_WIDTH`, `REVEAL_COLUMN_OFFSET`, `REVEAL_COLUMN_RATE`,
  `styles.revealColumn` (`justifyContent: 'flex-end'`,
  `paddingRight: TRANSCRIPT_MARGIN - REVEAL_COLUMN_LANDING`) in `ChatScreen.js`;
  `__tests__/resistedReveal-test.js`.
- **Notes:** narrower than `REVEAL_COLUMN`, "11:48 PM" wraps. Native Messages leaves 17
  pt between a sent balloon and its time; `revealGap` leaves 16 (the transcript margin).

### Timestamp reveal ink curve

- **Value:** alpha = (travel / settled travel)^2.2. Native readings at 26.00, 35.33,
  42.33, 48.67, 53.33 and 58.00 pt of 58: 0.20, 0.34, 0.50, 0.67, 0.81, 0.99.
- **What it is:** the revealed times' opacity against the fraction of the settled
  travel.
- **Measured:** ink per frame against the balloon's trailing edge. The ink holds to the
  hundredth whenever the finger stops, so the drag drives it, not a clock. rms of the
  fits: `p^2.2` 0.018, `p^2` 0.029, `cubic-bezier(.5,0,1,1)` 0.048, `ease-in` 0.077,
  `linear` 0.208.
- **Used by:** `REVEAL_INK_CURVE`, `revealInk`, `REVEAL_INK_STOPS`, `revealInkRamp` in
  `reveal.js`; `CAPTURE` in `__tests__/resistedReveal-test.js` (within 0.036, twice the
  rms; the ramp within 0.006); `inkCurve` in `ReactionCheck.swift`; `RevealShot.swift`.
- **Notes:** 8 straight segments stay within 0.005 of the curve. The demo's own curve
  (`RevealShot.swift`, recorded with `simctl io recordVideo`): 0.015 rms from `p^2.2`
  over the drag's 161 frames (worst 0.029), against 0.16 for a linear fade; steady to
  0.009 over a 125-frame hold; the same curve on release.

## Composer

### Composer landmarks, docked

- **Value:** keyboard down, native / ours: pill top 805.67 / 805.33 and bottom 846.00 /
  846.00 (28.00 from the screen's edge in both); `+` glyph x 40.33–55.33 in both;
  dictation glyph fill (180, 184, 191) in both; last receipt's ink to the pill 20.34 /
  21.33. Native boxes: the `+` circle is 40 × 40 at x 28–68, the field 40 tall at x
  80–374, both ending 28 pt above the bottom: one 40 pt row, a 12 pt gap, a 28 pt margin
  at the sides and bottom.
- **What it is:** the docked composer's positions (y from the window's top, x from its
  leading edge).
- **Measured:** screenshots of both apps; `tools/composer-diff.py --docked`.
- **Used by:** `LINE`, `PLUS`, `GAP`, `COMPOSER_CONCENTRIC`, `COMPOSER_DOCKED_SIDE`,
  `COMPOSER_DOCKED_BOTTOM`, `padding` in `ComposerBar`, `styles.plus`, the non-iOS
  `MIC_TINT` in `Composer.js`; `DockCheck.swift`: docked, the `+` starts 28 ± 1 pt from
  the leading edge and ends 28 ± 1.5 pt above the bottom; raised, it starts at 16 ± 1;
  the field's trailing edge moves 12 ± 1.5 pt between the two (a difference, because the
  field's accessibility frame is its text box, 10 pt inside the pill).
- **Notes:** the docked layout isn't the raised one. 28 is concentric with the display's
  corner and applies only docked; a bar keeping its raised 16 pt margin puts the `+`
  glyph at x 28.33, 12 short. iOS 27 replaces the dictation glyph with the audio-message
  button ("Composer audio glyph").

### Composer landmarks, dark mode

- **Value:** keyboard down, dark mode, native / ours: field interior 25 / 25; field rim
  54 / 52; `+` glyph x 40.33–55.67 in both; `+` circle interior / rim 25 / 54 against
  ours 19 / 47 (re-measure); field's leading edge x 67.00 in both.
- **What it is:** grey levels and x positions over the same dark backdrop.
- **Measured:** both apps.
- **Used by:** the glass field and `+` button in `Composer.js`.
- **Notes:** our `+` circle figures predate the current glass `+` (a `<button>` with
  `appleVisualEffect={FIELD_GLASS_KEYWORD}`, the `showsPanelPlus` branch).

### Composer bottom padding

- **Value:** 28 pt, against a 34 pt bottom safe area.
- **What it is:** from the docked pill's bottom to the screen's bottom edge.
- **Measured:** both apps docked: the native pill ends 28 pt above the edge; a bar that
  reserves the home-indicator strip ends 34 pt above it.
- **Used by:** `COMPOSER_CONCENTRIC`, `COMPOSER_DOCKED_BOTTOM`, `padding`,
  `automaticInsets={false}` on `<native:keyboardaccessory>` in `Composer.js`;
  `SafeAreaDefaults.md`; `DockCheck.swift`.
- **Notes:** the native pill overlaps the strip, which no padding can do while the
  element reserves it, so the bar reserves nothing and pads the whole distance.
  Reserving and padding both puts the composer 22 pt above the native one.

### Composer field height

- **Value:** iOS 40 pt; Android 56 dp.
- **What it is:** the pill's height with one line; also the bar's layout unit (`LINE`).
- **Measured:** iOS: "Composer landmarks, docked". Android: Material's filled text field
  is 56 dp; Google Messages' pill is 55.6.
- **Used by:** `LINE`, and through it `FIELD_INSET`, `SEND_H`, `styles.field`
  `minHeight`, `styles.glass` `borderRadius` in `Composer.js`.
- **Notes:** 40 pt looks cramped on Android. On iOS, `<textarea>`'s default `rows="2"`
  makes the pill 56.6 pt (hence `rows={1}`), and the user-agent's fixed height
  (`insetBlock` 16 + `rows` × `LINE_HEIGHT`) overrides `minHeight` and gives 36.3 pt
  (hence `height: 'auto'`).

### Composer line box

- **Value:** 20.2871 pt, `[UIFont systemFontOfSize:17].lineHeight`.
- **What it is:** one line of the field's text.
- **Measured:** the UIFont value; the native composer's one-line text height matches.
  The composer uses the balloon's 17 pt face; `EXPElementTextAreaComponentView` sets
  `<textarea>` to 17 pt in `init`.
- **Used by:** `LINE_HEIGHT`, `FIELD_INSET`, the `FALLBACK_LINES` ceiling,
  `styles.field` `maxHeight` in `Composer.js`.
- **Notes:** not rounded: a line box a third of a point too tall shrinks the inset by a
  sixth at each end, and twelve lines multiply that eleven times. Balloons use 20 pt
  ("Message line height").

### Composer side margins

- **Value:** 16 pt leading and trailing, raised.
- **What it is:** screen edge to the `+`, and pill to screen edge.
- **Measured:** 393 pt window. Trailing, from a device recording: the pill and a sent
  balloon both end at x 376.7, 16.3 pt from the edge. Leading: `+` disc at x 16.0–55.7,
  pill starting at 68.0.
- **Used by:** `COMPOSER_MARGIN`, `COMPOSER_MARGIN_TRAILING` in `Composer.js`;
  `TRANSCRIPT_MARGIN` in `ChatScreen.js`; `raisedLeading`, `raisedTrailing` in
  `DockCheck.swift`.
- **Notes:** a sent balloon keeps the pill's right edge through the send animation, so
  `COMPOSER_MARGIN_TRAILING` must equal `TRANSCRIPT_MARGIN`.

### Composer raised bottom

- **Value:** iOS 16 pt; Android 8 dp.
- **What it is:** pill row to the top of the keys, raised. iOS has nothing above the row
  (`BAR_TOP_PADDING` 0); Android centres the row with 8 above and below.
- **Measured:** iOS 26.5: both keyboards start at y 539.67 and the native `+` is centred
  at 502.83, leaving 16.84 pt (16 puts ours on that centre, 17 a point above); on iOS 27
  the native `+` is at 509.5 and ours follows. Android: Google Messages' row ends at
  569.9 dp, the keys start at 577.9; docked, its row ends 8 dp above the gesture strip,
  so Android's docked margins equal its raised ones.
- **Used by:** `COMPOSER_BOTTOM_RAISED`, and `COMPOSER_DOCKED_BOTTOM` on Android, in
  `Composer.js`; `testTheBarSitsWhereThePlatformDoesOnTheKeys` in `DockCheck.swift` (the
  `+` button's centre at y 509.5 ± 2 on iOS 27; ours 510.0; the button's frame, since
  the glyph isn't an element).

### Composer bar top padding

- **Value:** iOS 0 pt; Android 8 dp.
- **What it is:** bar top to pill top.
- **Measured:** docked with a full transcript, the native bar has no vertical cover
  insets and nothing above its background, leaving 20.3 pt from the last receipt's ink
  to the field. Google Messages: 24.3 dp above its field, 28.3 dp below. Android's 8 is
  chosen at this bar's scale.
- **Used by:** `BAR_TOP_PADDING` (`styles.barBox`) in `Composer.js`; the send
  animation's start position in `ChatScreen.js`, which must use the same value.

### Composer text insets

- **Value:** leading 16 pt; top and bottom `(LINE − LINE_HEIGHT) / 2`. The trailing 5 pt
  is in "Text column: composer field vs balloon".
- **What it is:** pill edge to caret (not ink); the vertical inset centres one line box
  in the pill.
- **Measured:** caret against caret with the same draft: native caret at x 96.33, pill
  edges within a third of a point. `lineFragmentPadding` is zero natively.
- **Used by:** `styles.field` `paddingLeft`, and `paddingTop`/`paddingBottom` via
  `FIELD_INSET`, in `Composer.js`.
- **Notes:** measured to the ink it includes the glyph's side bearing. Material also
  insets by 16.

### Text column: composer field vs balloon

- **Value:** 150 narrow glyphs fill 250.00 pt of the native field and 249.67 pt of a
  native balloon. Our field's `paddingRight` is 5 pt, making its text column 252.67 pt:
  the balloon's max width less twice `BUBBLE_PADDING`.
- **What it is:** the width where lines wrap in the field and in a sent balloon.
- **Measured:** the same probe puts the native field's trailing inset at 2.6–6.2 pt. In
  the demo, 66 narrow glyphs (`I` then 65 `i`, since the keyboard capitalises the first)
  fill one raised line and the 67th wraps; one glyph (3.74 pt) is `WrapCheck`'s
  resolution, and the counts hold for the 402 pt window only.
- **Used by:** `styles.field` `paddingRight`, `SEND_INSET_TRAILING` in `Composer.js`;
  `BALLOON_PLUS_RESERVE`, `BALLOON_MAX_WIDTH`, `BUBBLE_PADDING` in `ChatScreen.js`;
  `fits`, `wraps` in `WrapCheck.swift` (field and balloon break at the same glyph).
- **Notes:** equal columns keep a message's line breaks through the send; the flying
  balloon is laid out once, at the row's width. **Unreconciled:** this gives the field
  252.67 pt, equal to the balloon; the sums in "Balloon max width" give c − 149.5
  against c − 149.333.

### Caret height

- **Value:** ours 20.67 pt; native 22.00 pt, same 17 pt font. Every other landmark
  `tools/composer-diff.py` measures, raised, agrees within a third of a point.
- **What it is:** the text caret's height in the field.
- **Measured:** keyboard raised, `tools/composer-diff.py`.
- **Used by:** the `<textarea>` in `Composer.js`.
- **Notes:** `<textarea>`'s caret is `UITextView`'s, the font's line box; the native one
  is taller. Not fixed.

### Composer growth

- **Value:** the native field doesn't animate its height either way and has no line
  limit.
- **What it is:** how the native composer's height follows a draft and a send.
- **Measured:** 5–20 ms per frame. Growing: one line at 1895 ms, two at 1911 ms, one
  frame. After a send: two lines of text, then one line of placeholder the next frame
  (its 100 ms resize duration isn't used), with the balloon's two-line box over the text
  on that frame. About ninety words grow it up under the navigation bar; sixteen lines
  stop under the header and scroll.
- **Used by:** `glassSettled`, `FIELD_SHRINK`, `FIELD_SHRINK_DELAY`, `FALLBACK_LINES`,
  `getRoom`, `ceiling`, `styles.field` `maxHeight` in `Composer.js`.
- **Notes:** ours keeps the old height until `FIELD_SHRINK_DELAY` (120 ms) after
  `handoff` clears (when the sent balloon becomes visible), then eases over
  `FIELD_SHRINK` (180 ms); both chosen. The twelve-line `maxHeight` fits a phone in
  portrait.

### Composer send button

- **Value:** a 38 × 28 pt capsule; 6 pt from the pill's top and bottom (40 − 2 × 6 =
  28), 6.5 pt from its right edge.
- **What it is:** the send button's box and clearance.
- **Measured:** the native button is 38.00 × 28.00 pt (ours within a third of a point; a
  separate one-frame 3x reading agrees), its right edge at x 379.67 against a pill
  stroke at 385.67–386.33, so 6.33–6.67 clearance. A corner fit on a 37.96 × 27.31
  reading matches half-height circles within a fifth of a point.
- **Used by:** `SEND_W`, `SEND_H`, `SEND_INSET`, `SEND_INSET_TRAILING`, `styles.send`,
  `styles.glass` `paddingRight` in `Composer.js`.
- **Notes:** a capsule, matching the field's end. The trailing clearance fixes where the
  field's text column ends.

### Send arrow ink

- **Value:** U+2191 at 22 pt, semibold, white, `lineHeight` = `SEND_H`. Ink: ours 13.00
  × 16.00 pt, shaft 2.33; native 13.00 × 15.67, shaft 2.00; both heads 5.67 pt wide 2 pt
  below the tip.
- **What it is:** the send arrow's ink box, shaft and head.
- **Measured:** screenshots at 3x; the difference is one pixel, the comparison's limit
  (accepted).
- **Used by:** `styles.glyph`, the send button's `↑` `<span>` in `Composer.js`.
- **Notes:** the native arrow is its own vector artwork, not an SF Symbol: a 26 × 26
  shape with the arrow cut out (ink 11.33 × 14.00, shaft 2.50; scaled to the measured
  height its shaft would be 2.80, so it doesn't match what's drawn either). `arrow.up`
  at 17 pt: regular 12.67 × 15.67 / 1.42, medium 12.83 × 15.67 / 1.75, semibold 13.00 ×
  15.75 / 2.25; none matches ink, shaft and head together.

### Composer audio glyph

- **Value:** five round-ended bars 4 / 8 / 16 / 8 / 4 pt tall, 2 wide, 2 apart (4 pt
  pitch), ending 11.9 pt from the pill's right edge, centred on a one-line pill.
  `placeholderText` on iOS; `rgb(180, 184, 191)` elsewhere.
- **What it is:** the audio-message glyph in an empty field (iOS 27).
- **Measured:** ChatKit's `AudioMessageEntryViewButton` asset is 8 / 16 / 32 / 16 / 8
  tall, 4 wide, 8 apart, drawn at half size: 18.00 × 15.67 pt of ink. A column profile
  of a native screenshot: bars at 29.42 / 25.45 / 21.49 / 17.52 / 13.55 pt from the
  pill's right edge, 5.29 / 8.60 / 17.19 / 8.93 / 4.30 tall, the last ending 11.90 pt
  in; ours 5 / 9 / 17 / 8 / 4 at a 4.00 pitch (native 3.97); ink and pill centred at y
  43.50. The native tint is `rgba(180, 184, 191, 1)` light, `rgba(74, 75, 77, 1)` dark
  (composited).
- **Used by:** `AUDIO_BARS`, `AUDIO_BAR_W`, `AUDIO_BAR_GAP`, `AUDIO_INSET_TRAILING`
  (11.9 less `SEND_INSET_TRAILING`), `MIC_TINT`, `styles.audio`, `styles.audioBar`,
  `AUDIO_GLYPH` in `Composer.js`.
- **Notes:** no SF Symbols waveform is symmetric (`waveform` is 4 / 10.67 / 17.33 / 8.67
  / 14 / 5.33). The non-iOS colour is the light composite, opaque.

### Autocorrection after the send tap

- **Value:** 16 ms, tap first.
- **What it is:** from the send tap reaching JavaScript to the keyboard's autocorrection
  edit reaching it. The keyboard applies a pending correction when a touch is outside
  the word; the edit follows the tap on the same queue.
- **Measured:** traced on an iOS device.
- **Used by:** `send` (waits one turn before `sendNow`), `sending`, `fieldText` in
  `ChatScreen.js`.

## Composer `+` button

### Plus glyph

- **Value:** iOS: bars 15.3333 pt long, stroke set to 2.25 (draws 2.00). Android: 24 dp,
  2 dp stroke.
- **What it is:** the `+` glyph's two round-ended bars: length (ink extent) and
  thickness.
- **Measured:** one frame, one threshold, 3x, strokes sampled away from the ends: native
  15.33 pt, stroke 2.00, 494 px of ink; ours at 1.5833: 15.33 / 1.33 / 348 px; at 2.25:
  15.33 / 2.00 / 508 px (3% more ink).
- **Used by:** `PLUS_ICON`, `PLUS_ICON_STROKE`, `styles.plusIcon`, `styles.plusBarH`,
  `styles.plusBarV` in `Composer.js`.
- **Notes:** the native glyph is SF Symbol `plus` at pointSize 19, regular, scale
  medium, the only match in a search; that draws 15.3333 / 1.5833 (light: 15.00 / 1.17),
  and the renderer draws a stroke about 0.25 pt thinner at its core, so 1.5833 × 494 /
  348 = 2.25. UIKit's button configuration (16, medium) gives 13.00 / 1.67, not what's
  drawn. A separate side-by-side recording with a different threshold reads the native
  stroke as 1.33 (stroke/ink 0.087 against SF Pro `+` 13.67 / 2.00 / 0.146, light 0.100,
  thin 0.070). Material's icons are 24 dp with 2 dp strokes, as are Google Messages'.

### Plus card geometry

- **Value:** 11 pt from the screen's edges and above and below the rows; circular corner
  radius 30; row pitch 66; a 38 pt tile 34 pt from the card's left edge; label at x 99
  from it, 24 pt text; height at most 452.
- **What it is:** the card the `+` opens on iOS.
- **Measured:** the native send menu: 319 pt wide, 11 pt in, on a 393 pt window (x
  10–332 on 402); y 375–827, taller than the 336 pt keyboard. A superellipse fit to the
  corner gives n = 2.0, r = 29.8 (residual 1.1 pt; the balloons' n = 5 fits five times
  worse). Native / ours: pitch 66.0 / 66.0, tile 38.33 / 38.00 (read from `Apple Cash`'s
  solid disc), tile edge 45.00 / 45.00, label ink x 110.00 / 110.33. Label cap height
  17.7 / 0.7046 = 25.1, x-height 12.7 / 0.5186 = 24.4, at `UICTContentSizeCategoryL`.
  The shadow darkens the page from 255 to 245 at the card's foot.
- **Used by:** `PANEL_HEIGHT`, `PANEL_CARD_INSET`, `PANEL_CARD_RADIUS`, `PANEL_ROW`,
  `PANEL_TILE`, `PANEL_TILE_INSET`, `PANEL_LABEL_X`, `PANEL_LABEL_SIZE`, `panelMetrics`,
  `styles.panelBox`, `styles.panelCard`, `styles.panelList`, `styles.panelItem`,
  `styles.panelTile` in `Composer.js`.
- **Notes:** ours is 352 pt wide because our labels are longer ("Dismiss the keyboard"),
  so the inset is fixed, not the width. 24 pt is larger than any menu text style. Off
  iOS, `boxShadow: 0 8px 24px rgba(0, 0, 0, 0.16)` replaces the glass's shadow.

### Plus card content arrival

- **Value:** 25 ms delay; opacity spring mass 1, stiffness 203.35, damping 28.5202
  (critical, settles in 648 ms).
- **What it is:** the card contents fading in as it opens.
- **Measured:** native Messages' send-menu animators (reading method not recorded);
  their text and icon blur springs (mass 2, stiffness 300, damping 50, from blur radii
  17 and 3.33) aren't reproduced.
- **Used by:** `PANEL_CONTENT_DELAY`, `PANEL_CONTENT_SPRING` in `Composer.js`;
  `DOM-CSS-DEVIATION(panel-content-fades-without-the-blur)`.

## Keyboard & safe area

### Bar travel in the keyboard's first frame

- **Value:** 79 pt in one frame. Mid-transition the bar's layout and drawn positions
  differ by 5 pt; with the keyboard up, a view inside the accessory reports its laid-out
  y, 328 pt from where it is drawn.
- **What it is:** how far the composer bar moves in the keyboard's first frame (while
  the transcript's offset, clamped, doesn't move), and the bar's layout against its
  presentation-tree position.
- **Measured:** the app's trace; the dock event samples the drawn top and height every
  frame of a transition (device not recorded).
- **Used by:** `drawn`, `barBottom`, `onTranscriptScroll`, `rememberFlightFrame` in
  `ChatScreen.js`; `AnimatedKeyboardAccessory`, `barTopValue`/`barHeightValue`,
  `onBarTop`, `fieldRef` in `Composer.js`.
- **Notes:** JavaScript gets the drawn values a frame late, so the send animation's ends
  are driven natively. Only the x of a window measurement inside the accessory is
  usable. **Unreconciled:** `tools/gate.sh` gives the keyboard's first frame as 86 pt;
  the sources name different elements (keyboard, bar) and no device or run.

### Keyboard reveal at the 60fps cap

- **Value:** samples every 16.7 ms; the keyboard's obstruction grows up to 48 pt between
  samples.
- **What it is:** the app's geometry-trace interval during a keyboard reveal, and the
  largest change in how much of the window the keyboard covers, with the app held to 60
  fps while the keyboard runs at 120.
- **Measured:** `EXPKeyboardTrace` on a 120 Hz device without
  `CADisableMinimumFrameDurationOnPhone`.
- **Used by:** `CADisableMinimumFrameDurationOnPhone: true` in `ios/project.yml`.
- **Notes:** without that key iOS holds an iPhone app to 60 fps, but not the keyboard's
  window.

### Composer landscape insets

- **Value:** native landscape: `+` at x 78 pt (62 pt safe area + 16); send button ends
  6.33 pt inside x 812.
- **What it is:** the native composer's horizontal positions beside the sensor housing.
- **Measured:** native Messages in landscape (device not recorded).
- **Used by:** `styles.barBox` `marginLeft`/`marginRight`
  (`env('safe-area-inset-left'/'-right')`) in `Composer.js`.

### Menu and keyboard window levels

- **Value:** a `UIMenu` (`UITextEffectsWindow`) is at window level 1; the keyboard
  (`UIRemoteKeyboardWindow`) at 10000001; an app's window level is clamped to 10000000.
- **What it is:** the window levels of a presented menu and of the keyboard.
- **Measured:** iOS; method not recorded.
- **Used by:** the `'html'` and `'native'` `+` kinds (`PLUS_KIND`) in `Composer.js`; the
  overlay presentation in `NativeKeyboardPanel.md`.
- **Notes:** a menu doesn't cover the keys (UIKit places it above them), and nothing in
  an app's window can be above the keyboard.

## Header

### Compact bar scroll edge

- **Value:** y 0–75 reads (180, 240, 255) throughout; y 78 reads (83, 194, 250), the
  balloon at full strength. No ramp.
- **What it is:** RGB down one column through a balloon behind the navigation bar: the
  compact bar's scroll edge is hard.
- **Measured:** native Messages on an 874 pt screen.
- **Used by:** `LANDSCAPE` (`top: 'automatic'`) in `headerEdge.js`;
  `__tests__/headerEdge-test.js`.
- **Notes:** a `soft` edge under a compact bar ramps past the bar's bottom and fades the
  sender name below it.

## Colors & materials

### Balloon colours

- **Value:** light: top `#5AC8FA`, bottom `#0088FF`; dark: top `#409CFF`, bottom
  `#0091FF`.
- **What it is:** the sent balloon's vertical gradient stops, positioned against the
  screen, not the balloon.
- **Measured:** sampled from native balloons. By eye the top stop reads `#1FA2FF`; it is
  more cyan than it looks.
- **Used by:** `BALLOON_BLUE`, `balloonGradient`, `BADGE_FILL`, `styles.mineBalloon` in
  `ChatScreen.js`.
- **Notes:** flat fills that match the balloon (the reaction badge, the send button, the
  caret) use the bottom stop, (0, 136, 255).

### Received balloon grey

- **Value:** light `#E9E9EB`, dark `#262629`, opaque.
- **What it is:** the received balloon's (and typing indicator's) fill:
  `secondarySystemFill`, rgba(120, 120, 128, 0.16) light and 0.32 dark, flattened over
  the page.
- **Measured:** the native typing indicator's background, already flattened: light
  (0.915294, 0.915294, 0.920314), dark (0.150588, 0.150588, 0.160627). All four match
  the flattening exactly, e.g. (120·0.16 + 255·0.84)/255 = 0.915294 and 120·0.32/255 =
  0.150588.
- **Used by:** `BUBBLE_GREY` in `ChatScreen.js`; the README's note on the received grey.
- **Notes:** a light reading of `#E5E5EA` (`systemGray5`) is four levels off and
  light-only; `systemGray5` in dark is (44, 44, 46) against (38, 38, 41). Opaque because
  the context menu lifts the balloon onto a clear platter (iOS 27 device), where a 16%
  fill over the dimmed page looks muddy. Android keeps the semantic fill.

### Send blue and caret

- **Value:** iOS `#0088FF` light, `#0091FF` dark (`DynamicColorIOS`); Android
  `?attr/colorPrimary`; `#0088FF` elsewhere.
- **What it is:** the send button's fill and the caret: the balloon gradient's bottom
  stop.
- **Measured:** the native caret is (0, 136, 255), like the send button. An unset caret
  takes the app's `tintColor`, (66, 107, 242).
- **Used by:** `SEND_FILL`, `styles.send`, `caretColor` in `Composer.js`; `BALLOON_BLUE`
  in `ChatScreen.js`.
- **Notes:** the native theme keeps a send-button colour per balloon theme.

### Plus glyph colour

- **Value:** ours `label`; native `#858E99`.
- **What it is:** the `+` glyph's fill.
- **Measured:** the native glyph on its opaque grey circle (method not recorded).
- **Used by:** `styles.plusBarH`, `styles.plusBarV` in `Composer.js`.
- **Notes:** on our glass, close to the page's colour, the native grey looks too faint.

### Composer bar top fade

- **Value:** 30 pt.
- **What it is:** from the bar's top edge to full material strength
  (`appleVisualEffectFade`).
- **Measured:** a column beside the pill over a white page: darkening starts at y 471, 4
  pt above the bar, and reaches 251 at y 505, 30 pt in, easing off by the bar's bottom
  (a four-level dip about 70 pt wide). Without a fade ours reads 255 throughout.
- **Used by:** `FADE` in `Composer.js`; the start above the bar is
  `EXPKeyboardAccessoryMaterialRise` in `EXPKeyboardAccessoryComponentView.mm`.

### Composer bar material strength

- **Value:** 0.7.
- **What it is:** the opacity of the bar's material view (`appleVisualEffectOpacity`)
  over `-apple-system-blur-material-chrome`.
- **Measured:** dark, over a black page, bar RGB: native (0, 0, 0); ours at 1.00 (19,
  19, 19), the system chrome material; 0.80 (15, 15, 15); 0.65 (13, 12, 12); 0.50 (10,
  10, 10). Chrome is the darkest style: thin, thick and ultra-thin read (31, 31, 31).
  The native bar turns a green balloon's (32, 121, 54) into (67, 124, 81), and a
  balloon's text detail drops from 15.99 above the bar to 8.21 under it. At 0.65 a
  balloon edge under the bar spreads over 159–172 pt.
- **Used by:** `BAR_MATERIAL_STRENGTH` in `Composer.js`; `appleVisualEffectOpacity` in
  `ExpoKeyboardAccessoryShadowNode.h`.
- **Notes:** the simulator doesn't blur like a device, so 0.7 is chosen on a device.
  Lower opacity is darker and less blurred.

### Composer bar material over a sent balloon

- **Value:** the material lightens a sent balloon's blue by about 60 levels (a grey by
  about 12). 6 pt inside the bar: two thirds, about 70 levels; 6 pt above, inside its 12
  pt rise: a tenth, about 8. The balloon's gradient changes half a level per 10 pt.
- **What it is:** the change in mean level, (r + g + b) / 3, under the demo's bar by
  distance from its top edge.
- **Measured:** `MaterialCheck`'s readings (`MEASURE material …`).
- **Used by:** `testTheBarCoversContentAndNothingAboveIt` in `MaterialCheck.swift` (≤ 3
  levels 16–26 pt above the bar, > 6 levels from 16 pt above to 6 pt below);
  `EXPKeyboardAccessoryMaterialRise`; `FADE`.
- **Notes:** blue shows the material five times as strongly as grey; a fill over its own
  colour shows nothing. The 3-level tolerance is row-average noise plus the gradient.

### Composer field glass

- **Value:** `-apple-system-glass-material` (regular), untinted, no fill, no shadow.
- **What it is:** the field's surface on iOS, also used by the glass `+`.
- **Measured:** untinted it reads 252.7 light and 19 dark against the native 254.34 /
  25; a fitted tint reads 254.88 / 4. The native field has a single blur of radius 24.
- **Used by:** `FIELD_GLASS_KEYWORD`, `styles.glass` in `Composer.js`.
- **Notes:** the tint looks frosted and clear glass too bright. The blur radius can't be
  set (`effectWithBlurRadius:` isn't public; the keywords map to `UIBlurEffectStyle`).
  Glass scales to 1.05 under a finger and merges the `+` and the field within 12 pt.
  `overflow: hidden` cuts a field's shadow from four levels to a third of one
  (`DOM-CSS-LIMITATION(clipping-eats-the-shadow)`).

## Android

### Composer bar fill (Android)

- **Value:** `rgba(250, 255, 255, 0.70)`; none on iOS.
- **What it is:** the bar's fill where there is no material.
- **Measured:** fitted against the native app on a device over content (over a flat page
  fill and blur look alike): 0.873 is too solid, 0.50 too clear.
- **Used by:** `BAR_FILL`, `styles.bar` in `Composer.js`.

### Composer field fill (Android)

- **Value:** `uiColor('systemGray5')` (Material's `colorSurfaceContainerHighest`).
- **What it is:** the field's fill on Android.
- **Measured:** Google Messages' pill reads (241, 240, 247) on a (248, 249, 255) page.
- **Used by:** `styles.glass` in `Composer.js`.

### Plus button (Android)

- **Value:** a 48 dp box, bottom margin `(LINE − PLUS) / 2`.
- **What it is:** Material's touch target for the `+`, around its 40 dp tonal pill and
  24 dp icon.
- **Measured:** Material's specified sizes.
- **Used by:** `PLUS`, `styles.plus` in `Composer.js`.
- **Notes:** shorter than the 56 dp field because Material sizes buttons and fields
  separately; centred on a one-line field, aligned with the last line as it grows. The
  radius is left to Android for Material's shape and ripple.

### Composer under the collapsing toolbar

- **Value:** the composer is shifted 168 px down, past the screen's bottom; its top 22
  px show.
- **What it is:** the effect of the opt-in collapsing toolbar: `CoordinatorLayout` gives
  the React surface the full window height and offsets it by the app bar.
- **Measured:** the demo with `--ez toolbar true` (device not recorded).
- **Used by:** the opt-in toolbar in `createReactActivityDelegate` (`MainActivity.kt`);
  `android/app/src/main/res/layout/main.xml`.
- **Notes:** documented `CoordinatorLayout` behaviour: a bottom bar belongs outside it.

### RN Tester content never reaches the system bars

- **Value:** RN Tester's scroll view is at y 535, 1631 tall, in a 2400-tall window with
  system bars `[0, 136, 0, 63]`.
- **What it is:** nothing in RN Tester's surface overlaps a bar, so its safe-area
  reservation is correctly zero and can't be judged by eye.
- **Measured:** RN Tester on Android (units and device not recorded; why it is placed
  there is not established).
- **Used by:** the reason for this app (`App.js` header, `README.md`);
  `WindowCompat.setDecorFitsSystemWindows(window, false)` in `MainActivity.kt`;
  `AppTheme` in `android/app/src/main/res/values/styles.xml`; `edgeToEdgeEnabled` in
  `android/app/gradle.properties`.

### LogBox toast hit area

- **Value:** the "Open debugger to view warnings" container spans y 2008 to the bottom
  of a 2400-tall window, far above the visible toast.
- **What it is:** where LogBox's collapsed toast intercepts taps, including the composer
  controls that move with the keyboard.
- **Measured:** this app (units not recorded).
- **Used by:** `LogBox.ignoreAllLogs(true)` in `index.js`.
- **Notes:** with the toast up, tap-driven checks on those controls fail as if the
  buttons did nothing.

## Performance

### Transcript row elements per keystroke

- **Value:** 26 ms per typed character, 60 ms per send, at 3,000 messages, with no row
  body running.
- **What it is:** JavaScript time re-running `messages.map` and building every row's
  element when `Chat` re-renders. `React.memo(BubbleImpl)` skips row bodies, not element
  building; the `Transcript` memo boundary removes the cost.
- **Measured:** the demo (device and build not recorded).
- **Used by:** `Transcript` (`React.memo`), `Bubble` in `ChatScreen.js`.
- **Notes:** with the boundary, a `Chat` render that changes none of `Transcript`'s
  props (refs, memoised values, `useCallback`s, primitives) does no row work.

### Frame meter renderer read cost

- **Value:** tens of microseconds per frame for 30 numbers.
- **What it is:** one synchronous `RenderStats.read()` (a struct copy of the renderer's
  counters via `NativeRenderStats`) per JavaScript frame, against a 16 ms budget; only
  while profiling (`setProfiling`).
- **Measured:** device and build not recorded.
- **Used by:** `meterFrames` in `ChatScreen.js`; `NativeRenderStats.js`.

### Keyboard rebuild during a send

- **Value:** a keyboard rebuild is 113 ms of main thread in one turn on a phone, about
  seven dropped frames. A send's field clear costs about 19 ms, almost none of it ours;
  the gate allows our part (`ours=`) under 4 ms.
- **What it is:** the rebuild follows telling the input system about a field change (a
  controlled clear, a correction drop, other input-system updates). The clear is the
  whole `textarea write … len=0`: our passes plus UIKit's keyplane relayout (the caret
  at a sentence start switches the keyboard to shifted, laid out through Auto Layout
  inside `performTaskOnMainThread:waitUntilDone:`).
- **Measured:** 113 ms on an iOS phone (build not recorded); the clear by sampling.
- **Used by:** the `quiet` prop on `Composer` in `ChatScreen.js`; `quiet` in
  `Composer.js` and `ElementTextAreaShadowNode.h`; the in-flight rebuild and slow-clear
  checks in `tools/gate.sh`; `EXPElementTextAreaComponentView.mm` (`ours=`, deferred
  correction drop).

### Chat: jump to the latest message

- **Value:** 253 messages: focusing the composer near the bottom drops 0 of 41 frames;
  from the top, 2 (29 ms and 33 ms).
- **What it is:** frames dropped in the scroll to the latest message that focusing the
  composer triggers.
- **Measured:** the demo's trace, Release build.
- **Used by:** the `compose` handler (`scrollToLatest()`) and the per-message
  `VirtualView`s in `ChatScreen.js`.
- **Notes:** all 253 `VirtualView`s report a mode change, then one commit unmounts about
  250 rows and mounts ten.

### Virtualized prerender band

- **Value:** `virtualViewPrerenderRatio` 5.0: a row is `Hidden` about 4,000 pt
  (sixty-odd 64 pt rows) past the screen's edge.
- **What it is:** the viewport enlarged by the ratio on each side; `VirtualView`s
  outside it are `Hidden` and render `null`.
- **Measured:** from the flag and the demo's window.
- **Used by:** `ROW_COUNT` (10,000), `ROW_HEIGHT` (64) in
  `screens/VirtualizedScreen.js`; `lastRow` in `VirtualizedCheck.swift`.
- **Notes:** 640,000 pt of rows is about 160 bands, 700 screens. 400 rows already hide
  the far end, and the tree stays about the size of a 400-row list's.

### Virtualized sweep cost

- **Value:** 3.03 sample-ms per row scrolled, about half a millisecond a frame.
- **What it is:** main-thread time in the container's geometry sweep, which reads every
  `VirtualView`'s rect on every `scrollViewDidScroll:`, on the 10,000-row screen.
- **Measured:** this app, Release, sampled.
- **Used by:** `ROW_COUNT` in `screens/VirtualizedScreen.js`;
  `RCTVirtualViewProtocol.h`.
- **Notes:** linear in the list's length whatever is rendered; the largest main-thread
  cost while scrolling. It depends on avoiding `-convertRect:toView:`,
  `-[UIView superview]`'s lock, ARC autoreleasing a returned view ten thousand times a
  frame (the struct in `RCTVirtualViewProtocol.h` avoids this), and `CGRectGetMinY` as a
  real call.

### Virtualized time to open

- **Value:** 6,710 ms at 10,000 rows, 90 ms at 400 (0.68 and 0.19 ms per row).
- **What it is:** from the tap to the rows mounted, rows made by
  `createHiddenVirtualView({minHeight: ROW_HEIGHT})`.
- **Measured:** the demo, Debug build (whether the 400-row figure used hidden rows is
  not recorded).
- **Used by:** `HiddenRow`, `ROW_COUNT` in `screens/VirtualizedScreen.js`.
- **Notes:** grows faster than the row count while every row is an element;
  `unstable_VirtualColumn` avoids it.

### Virtualized screen's first accessibility query

- **Value:** over 20 s for XCUITest's first query on the ten-thousand-row tree (the
  screen opens in about 1 s); after a scroll, up to 8 s for modes and commits to settle
  (after 2 s the far end can still be in the tree).
- **What it is:** wall-clock time for the UI tests' first query and for the tree to
  reflect a jump.
- **Measured:** the UI suite (build not recorded).
- **Used by:** the 90 s readiness timeout in `DemoCase.setUpWithError`; `settle()` in
  `VirtualizedCheck.swift`.
- **Notes:** `allElementsBoundByIndex` over fifty to seventy messages takes minutes, so
  checks find rows by label.
