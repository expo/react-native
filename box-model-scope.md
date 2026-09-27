# Scope: margin, padding, border and outline for every box type

The fork now generates several kinds of CSS box. Decoration support across them
is uneven, and the gaps are not where you would guess — so this is a full
inventory of *what exists*, *what is missing*, and *what each missing piece
actually requires*, written against the code rather than from the spec.

Terminology follows CSS: the **content box** holds the content, then padding,
then border, then margin. `outline` is painted outside the border box and does
**not** affect layout.

---

## 1. The box types this fork produces

| # | Box | Produced by | Laid out by |
|---|---|---|---|
| B1 | Flex container/item | `View` (default) | Yoga flex |
| B2 | Block box | `display:'block'`, `<div>` | Yoga `calculateBlockLayout` |
| B3 | Atomic inline box | `display:'inline'` (sized, or non-inline content), `<img>` | measured by Yoga, *positioned* as an inline attachment |
| B4 | Span-like inline box | `display:'inline'` (auto-size, all-inline content) | none — contents fold into the parent IFC |
| B5 | Inline text element | `<b>`, `<i>`, `<span>`, `<u>`, nested `<Text>`, unknown tags | none — text runs in an IFC |
| B6 | Anonymous IFC box | generated around inline runs | Yoga leaf with a measure function |
| B7 | Text run / `#text` | character data | text engine only |

## 2. Status per box type

| Box | margin | padding | border | outline |
|---|---|---|---|---|
| B1 flex | ✅ Yoga | ✅ Yoga | ✅ Yoga + painted | ✅ painted |
| B2 block | ✅ Yoga **+ CSS2 §8.3.1 collapsing** | ✅ | ✅ | ✅ |
| B3 atomic inline | ✅ (G1) | ✅ | ✅ | ✅ |
| B4 span-like inline | ✅ | ✅ | ✅ | ✅ |
| B5 inline text element | ✅ (G2/G3) | ✅ | ✅ iOS/cxx (G4) | ✅ iOS/cxx (G5) |
| B6 anonymous box | n/a (spec: no decorations) | n/a | n/a | n/a |
| B7 text run | n/a | n/a | n/a | n/a |

So B1/B2 are essentially complete — the block work already covers margin
collapsing, which is the hard part. **Everything missing is inline.**

**Status:** G1–G5 are implemented and verified on iOS and the cxx measurer.
Android has the props and the layout half; its painting is the open item —
see §6.

## 3. The gaps, precisely

### G1 — Atomic inline boxes ignore their margins (small)

`InlineContentShadowNode` sizes an attachment from
`layoutable->measure(...)`, which returns the **border-box** size. An inline
`margin` therefore contributes nothing to the line, so `<View display="inline"
style={{margin: 8}}/>` sits flush against the surrounding glyphs.

**Required:** add the resolved inline-axis margins to the attachment's reserved
advance, and offset the stamped attachment frame by the leading margin.
Block-axis margins on an atomic inline do not affect the line box (CSS2 §10.8),
which matches leaving line height alone.

**Size:** S. Contained to the attachment sizing/placement path, headlessly
testable.

### G2 — Inline elements have no box props at all (medium, blocking G3/G4)

`TextProps` extends `Props, BaseTextProps` — **not** `ViewProps`. So `<span>`
and `<b>` have nowhere to put `padding`, `borderWidth`, `margin` or `outline*`;
the props are not merely unhandled, they are unparsable.

**Required:** a decoration prop set on inline text elements. Two options:

- **(a) Add a focused `InlineBoxProps`** (margin/padding/border/outline +
  colours/radius) to `BaseTextProps`. Cheap, no layout coupling, and keeps
  `<Text>`'s prop surface honest — RN `<Text>` has never had these.
- **(b) Make `TextProps` extend `ViewProps`.** Architecturally "an element is
  an element", and gets radius/shadow for free — but it hands authored `<Text>`
  a large prop surface that RN's `<Text>` does not implement, which risks
  implying support that is not there. It also enlarges every text node.

**Recommendation: (a).** It is reversible, and (b) can subsume it later if the
DOM-elements direction argues for one prop model.

### G3 — Inline decorations do not affect the line (medium/large)

On the web, an inline box's **inline-axis** padding/border/margin add to the
line's advance at the element's start and end edges, while its **block-axis**
padding/border do *not* change line height (CSS2 §10.6.1) — they simply paint,
overflowing the line box.

Our advance comes from the platform text engines, which have no notion of
"padding on a range". Options, in ascending fidelity:

1. **Boundary spacer runs** — inject zero-width fragments carrying a width at
   the element's edges. Works on all three engines through machinery that
   already exists (attachments reserve a box), and is exactly how the
   deterministic measurer would model it.
2. **Kerning attributes** at the boundaries (iOS `NSKernAttributeName`,
   Android `LetterSpacingSpan`-like). Cheaper but leaks into justification and
   is awkward to make symmetric.
3. **Native inline-box layout** — real fidelity, but means owning line
   breaking, which is precisely what we delegate to the platform today.

**Recommendation: (1)**, and document that block-axis padding paints without
affecting line height, matching CSS.

### G4 — Inline decorations are not painted (large, the real work)

A wrapped inline box paints **one box per line fragment**, with the leading
edge's border/radius only on the first fragment and the trailing edge's only on
the last (CSS2 §8.6 box fragmentation). Nothing paints this today.

**Now unblocked:** T14 gave us per-fragment rects on the cxx measurer, iOS
(`boundingRectForGlyphRange:`) and Android (`Layout` line geometry). The same
rects that let an element report its box tell us where to paint its fragments.

**Required:**
- Carry the decoration set into `ViewState`'s text runs (or a parallel list) so
  the mounting layer sees per-fragment boxes to draw.
- iOS: draw in the run view beneath the glyph pass (`RCTTextLayoutManager`
  already has a background-drawing pass to model it on).
- Android: draw in `ReactViewGroup.drawTextRun` before the `StaticLayout` draw;
  Android also has `LineBackgroundSpan`, which is a plausible shortcut.
- Fragmentation rules: first/last fragment get the leading/trailing border and
  radius; middle fragments get neither.

**Size:** L, and platform-specific in both painting layers.

### G5 — Outline on inline elements (small, after G4)

`outline` never affects layout, so once G4 can paint a per-fragment box, the
outline is the same geometry inflated by `outline-offset`, drawn outside the
border box. CSS paints an outline around the **union** of fragments by default
(`outline: auto`-ish behaviour differs per engine); we should paint per
fragment, which is what browsers do for `outline-style: solid`.

## 4. Recommended order

1. **G1** — atomic inline margins. Small, immediately useful, headlessly
   testable.
2. **G2(a)** — `InlineBoxProps` on inline text elements. Unblocks the rest.
3. **G3** via boundary spacers — inline-axis decorations affect the line.
4. **G4** — per-fragment painting, iOS then Android.
5. **G5** — outline, trivially after G4.

Each stage is independently verifiable, and every one has a Safari twin to pin
against — the same discipline used for block layout and margin collapsing.

## 5. Explicitly out of scope (and why)

- **Inline block-axis padding changing line height.** It does not on the web;
  matching means doing nothing.
- **`box-decoration-break: clone`.** Default is `slice`, which is what §4's
  fragmentation rules implement. `clone` can follow later.
- **Border radius across fragments.** Follows the same first/last rule as
  borders; called out because it is easy to get wrong when a box wraps.


## 6. Invariants worth not breaking

**Inline-axis spacing must never add characters.** G3 expresses an inline
element's margin/border/padding as *kerning* — on the preceding character for
the leading edge, on the element's own last character for the trailing one. A
zero-width spacer character is the obvious alternative and is wrong: the
`NSAttributedString` built for layout is the same one
`RCTParagraphComponentView.attributedText` hands to copy/selection and to
accessibility, so anything injected for layout lands in text the user reads and
copies. Kerning is also better on its own merits — it is part of a glyph's
advance, so line breaking accounts for it and it cannot be collapsed away as
whitespace.

**Inline decorations need a canvas bigger than the layout box.** Block-axis
padding/border/outline overflow the line box rather than growing it (CSS2
§10.6.1), so a view sized to the measured text clips them away. Both painting
paths widen only their *drawing surface*
(`RCTAnonymousTextRunView.setContainerBounds:` for bare runs,
`RCTParagraphComponentView.layoutSubviews` for paragraphs); neither touches
layout.

Note the failure mode both of these share: a **wrapped** box hides the bug,
because its middle lines' edges fall between lines and stay inside the frame.
Only a single-line box exposes it. Test both.

**Per-line rects must come from glyph positions.** Neither obvious API works:
`boundingRectForGlyphRange:` widens to the whole line fragment (and to the
container width once the range spans a break), and
`enumerateEnclosingRectsForGlyphRange:` is built for selection and *merges*
contiguous full-width lines into one tall rect. Both look plausible on screen
until the edges are checked per line.

**Anything that changes measurement must be part of the measure-cache key.**
`TextMeasureCache` is keyed by `areAttributedStringFragmentsEquivalentLayoutWise`,
which compares text and layout-affecting text attributes. G3's inline-axis
spacing changes the measured size, so it had to join that comparison — and its
hash, or the two disagree. Until it did, a padded and an unpadded run with the
same text were the *same key*, and every padded variant silently got the
unpadded measurement: an exact 0 delta on both platforms, for every shorthand
form, while the props parsed correctly and the spacing was genuinely applied to
the paint. Fantom's measurer does not use this cache, so the headless tests
could not see any of it.

Only the inline axis is compared. Block-axis padding and border overflow the
line box rather than growing it, so including them would cost cache misses for
no correctness gain.

**An element's reported box is its border box.** The leading inline-axis space
rides on the *preceding* character (no spacer character is ever injected), so it
falls outside the element's own glyph range and has to be added back by every
consumer that reports the element's geometry — the painting path and the
per-fragment rects on both platforms. The trailing space is on the element's own
last character and is already included.

## 7. Open

- **Android painting** (the G4/G5 half). The decorations now reach Android in
  the fragment MapBuffer, so what remains is the drawing itself in
  `ReactViewGroup.drawTextRun` / a `LineBackgroundSpan`.
- **`box-decoration-break: clone`.** Default `slice` is what §4 implements.
