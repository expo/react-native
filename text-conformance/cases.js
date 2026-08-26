/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The corpus, written once.
 *
 * Every case is a plain tree of `{tag, style, children}`. `toHTML` turns it
 * into markup for Safari and `toElements` turns the *same tree* into React
 * elements for the device, so "we rendered the same HTML" is a property of the
 * data rather than a claim about two hand-written copies that drift.
 *
 * ## Why these cases are pinnable to the pixel
 *
 * Text cannot be compared to a browser's coordinates: three engines shape with
 * three fonts, so a span's width is a fact about a font file rather than about
 * CSS, and comparing those numbers produces failures that mean nothing.
 *
 * So this corpus removes the font as a variable rather than working around it.
 * Every measured box is an **atomic inline with an explicit size**, laid out on
 * lines with an explicit `line-height`, and — where a case is not specifically
 * about baseline alignment — with `vertical-align: top`. Under those
 * constraints CSS determines every coordinate exactly: x accumulates from the
 * boxes' own widths, and y from `line-height` and the alignment. Nothing is
 * left to a font's ascent, descent or advance widths.
 *
 * The cases that *do* pin baseline behaviour keep text out of the line for the
 * same reason, and pin the geometry CSS fixes regardless of the strut.
 *
 * `WITH_TEXT` cases are marked and compared structurally instead — they are
 * here because the interesting bugs live where text and atomic inlines mix, and
 * a corpus that excluded them would pass while the product was broken.
 */

/*
 * A palette, so a screenshot is a usable check rather than a picture of
 * nothing. Colour is deliberately the ONLY thing here that does not affect
 * layout — the geometry is identical with or without it — but without a fill an
 * atomic inline is invisible, and the final visual comparison against the
 * browser could not be made at all.
 */
const COLOURS = [
  '#0a84ff',
  '#34c759',
  '#ff9500',
  '#af52de',
  '#ff3b30',
  '#30b0c7',
];
let colourIndex = 0;

/* A measured box. `m` is the key its rect is reported under. */
function box(m, w, h, extra) {
  const background = COLOURS[colourIndex++ % COLOURS.length];
  return {
    tag: 'span',
    m,
    style: {
      display: 'inline-block',
      width: `${w}px`,
      height: `${h}px`,
      verticalAlign: 'top',
      backgroundColor: background,
      ...(extra ?? {}),
    },
  };
}

/*
 * A measured block box, for the cases about MARGINS.
 *
 * Block rather than the atomic inline `box` above, because a margin in the
 * block direction is what these cases measure and an inline box has none that
 * applies (css-inline-3). Sized in px so the box itself contributes nothing
 * font-dependent; everything under test is the space around it.
 */
function marginBox(m, w, h, extra) {
  const background = COLOURS[colourIndex++ % COLOURS.length];
  return {
    tag: 'div',
    m,
    style: {
      width: `${w}px`,
      height: `${h}px`,
      backgroundColor: background,
      ...(extra ?? {}),
    },
  };
}

/* The block container every case is laid out in: a known width and line-height,
   no padding or border, so the container's content box starts at (0,0). */
function root(children, extra) {
  return {
    tag: 'div',
    m: 'root',
    style: {
      width: '300px',
      lineHeight: '20px',
      fontSize: '16px',
      ...(extra ?? {}),
    },
    children,
  };
}

function span(children, style, m) {
  return {tag: 'span', m, style: style ?? {}, children};
}

/*
 * How far two gaps may differ and still be the same length.
 *
 * A gap is `y₂ − (y₁ + h₁)`: three coordinates, each snapped to a whole device
 * pixel independently, so comparing two gaps accumulates the snapping at both
 * ends. On the densest screen in this matrix — the Android emulator at 420dpi,
 * density 2.625 — one pixel is 0.381pt, and two of them is 0.762. That is
 * exactly the disagreement this file first reported: two `1rem` margins
 * measured 16.38 and 15.62, both of them 16 snapped different ways.
 *
 * 1pt is the round number above that bound. It is a sixteenth of the quantity
 * these cases assert and a forty-eighth of the difference they exist to catch
 * (16 against 64), so it separates a real failure from the grid by a wide
 * margin rather than being slack tuned until the suite went green.
 */
const GAP_TOLERANCE = 1;

const CASES = [
  {
    name: 'atomic-inlines-in-a-row',
    why: 'Three sized atomic inlines with no text: x is the running sum of widths and nothing else.',
    tree: root([box('a', 40, 20), box('b', 60, 20), box('c', 30, 20)]),
  },
  {
    name: 'atomic-inlines-wrap',
    why: 'The fourth box does not fit in 300px, so it starts the next line at x=0.',
    tree: root([
      box('a', 100, 20),
      box('b', 100, 20),
      box('c', 100, 20),
      box('d', 100, 20),
    ]),
  },
  {
    name: 'atomic-inline-taller-than-line-height',
    why: 'Line growth: line-height is 20 and the box is 50, so the line box — and the container — must be 50 tall. Only one box, so nothing here depends on vertical-align.',
    tree: root([box('tall', 40, 50)]),
  },
  {
    name: 'text-only-honours-line-height',
    withText: true,
    heightOnly: true,
    why: 'A line of text with line-height 20 is 20 tall. Separates "line-height never reaches the run" from "line-height reaches text but not an attachment-only line".',
    tree: root(['Ag']),
  },
  {
    name: 'short-box-alone-honours-line-height',
    why: 'One 10pt box on a 20pt line: the strut floors the line box at 20 (CSS2 §10.8), so the container is 20 tall, not 10.',
    tree: root([box('only', 40, 10)]),
  },
  {
    name: 'line-height-is-a-floor-not-a-ceiling',
    why: "The inverse: a 10pt box on a 20pt line-height line still occupies a 20pt line box, because the strut sets a minimum (CSS2 §10.8). Two lines, so the second line's y shows the first line's height.",
    tree: root([box('shortA', 200, 10), box('shortB', 200, 10)]),
  },
  {
    name: 'a-tall-line-pushes-the-next-line-down',
    why: 'A 50pt box on line one, then a box that cannot fit beside it: the second line starts below the first line box, not one line-height down.',
    tree: root([box('tall', 200, 50), box('second', 200, 20)]),
  },
  {
    name: 'nested-in-one-inline',
    why: 'An inline box establishes no formatting context, so a box inside a <span> is on the same line at the same x as if it were a direct child.',
    tree: root([box('before', 40, 20), span([box('inner', 40, 20)])]),
  },
  {
    name: 'nested-three-deep',
    why: 'Depth is irrelevant to the IFC.',
    tree: root([
      box('before', 40, 20),
      span([span([span([box('inner', 40, 20)])])]),
    ]),
  },
  {
    name: 'nested-then-sibling',
    why: 'A box after a nested one continues the same line, so the nesting must not consume horizontal space of its own.',
    tree: root([span([box('inner', 40, 20)]), box('after', 40, 20)]),
  },
  {
    name: 'inline-flex-atomic',
    why: 'display:inline-flex is inline-level and atomic: it sits on the line like an inline-block and does not let its contents escape into the run.',
    tree: root([
      box('before', 40, 20),
      {
        tag: 'span',
        m: 'flex',
        style: {
          display: 'inline-flex',
          width: '80px',
          height: '20px',
          verticalAlign: 'top',
        },
        children: [box('flexchild', 20, 20)],
      },
      box('after', 40, 20),
    ]),
  },
  {
    name: 'inline-flex-lays-out-its-children',
    why: 'Its children are flex items in a row, so the second starts after the first — inside the flex box, not on the outer line.',
    tree: root([
      {
        tag: 'span',
        m: 'flex',
        style: {
          display: 'inline-flex',
          width: '120px',
          height: '30px',
          verticalAlign: 'top',
        },
        children: [box('i1', 30, 30), box('i2', 30, 30)],
      },
    ]),
  },
  {
    name: 'empty-inline-between-boxes',
    why: 'An inline element with no content contributes no width, so the boxes either side are adjacent.',
    tree: root([box('a', 40, 20), span([]), box('b', 40, 20)]),
  },
  {
    name: 'inline-with-padding-around-box',
    why: 'Horizontal padding on an inline box DOES apply (css-inline-3), so the inner box is pushed right by it.',
    tree: root([
      box('before', 40, 20),
      span([box('inner', 40, 20)], {paddingLeft: '10px', paddingRight: '10px'}),
      box('after', 40, 20),
    ]),
  },
  {
    name: 'vertical-align-top-vs-default',
    why: 'Two boxes of different heights, both aligned top: their tops are equal regardless of any font strut.',
    tree: root([box('short', 40, 20), box('tall', 40, 40)]),
  },
  {
    name: 'vertical-align-bottom',
    why: 'A short box aligned to the bottom of a line made tall by a taller sibling.',
    tree: root([
      box('tall', 40, 40),
      box('short', 40, 20, {verticalAlign: 'bottom'}),
    ]),
  },
  {
    name: 'vertical-align-middle',
    bounded: 'between-top-and-bottom',
    fontDependent:
      "CSS defines `middle` against the parent's X-HEIGHT (CSS2 §10.8.1), not " +
      'the middle of the line box — so its offset is a fact about a font file ' +
      'and cannot be pinned across three engines. What IS pinned: it lands ' +
      'strictly between `top` and `bottom`, and inside the line box.',
    why: "Centred on the line box rather than on the text's x-height, which is what CSS middle means for an atomic inline in the absence of text.",
    tree: root([
      box('tall', 40, 40),
      box('short', 40, 20, {verticalAlign: 'middle'}),
    ]),
  },
  {
    /*
     * This was an EXACT case and should never have been one.
     *
     * The line box here is the box (40) plus the strut's descent below the
     * baseline, and that descent is a fact about a font file — it is
     * `(lineHeight - (ascent + descent)) / 2 + descent` for whichever face the
     * engine picked. The three engines disagree, correctly: Safari 44, iOS
     * 44.33, Android 43.81. It passed only because those happen to sit inside
     * the 0.5pt rounding tolerance, and a font update moving a descender by
     * two thirds of a point would have turned correct behaviour into a
     * reported bug — the exact false positive this corpus exists to avoid.
     *
     * What CSS does fix, and what is asserted instead: the box keeps its
     * declared 30x40, its top is the top of the line box, and the line box is
     * STRICTLY TALLER than the box — which is the whole claim of the case,
     * that a baseline-aligned box does not get a line box its own height.
     */
    name: 'baseline-aligned-box-alone',
    bounded: 'line-taller-than-box',
    fontDependent:
      "The line box is the box plus the strut's descent below the baseline, " +
      'which is a font metric: Safari 44, iOS 44.33, Android 43.81 for the ' +
      'same 40pt box. Pinning it exactly compares fonts, not layout.',
    why: "A lone box with NO vertical-align, so baseline-aligned: its bottom sits on the baseline and the strut's descent still hangs below it, making the line taller than the box. Adjudicates whether the line should be exactly the box height.",
    tree: root([
      {
        tag: 'span',
        m: 'only',
        style: {
          display: 'inline-block',
          width: '30px',
          height: '40px',
          backgroundColor: '#0a84ff',
        },
      },
    ]),
  },
  {
    name: 'atomic-inline-alone-on-line',
    why: 'A single box in an otherwise empty block: the container height is the line box height, which the box drives when it exceeds line-height.',
    tree: root([box('only', 40, 60)]),
  },
  {
    name: 'wrap-boundary-exact',
    why: 'Boxes summing to exactly the container width stay on one line; the next one wraps. Pins the off-by-one at the wrap boundary.',
    tree: root([box('a', 150, 20), box('b', 150, 20), box('c', 10, 20)]),
  },
  {
    name: 'nested-inline-wrap',
    why: 'Wrapping inside a nested inline element: the inner box wraps to the next line and starts at x=0, not at the inline box origin.',
    tree: root([box('a', 200, 20), span([box('inner', 150, 20)])]),
  },
  // ---- structural only, because text is involved ----
  {
    /*
     * TWO measured boxes, not one, and that is the whole point.
     *
     * This case measured a single box and compared structurally, so its
     * signature was the string "mid" — one box, one line — which is what it
     * would be wherever the box landed. It passed for months without asserting
     * anything. A structural comparison needs at least two boxes to have a
     * relation to compare.
     */
    name: 'box-between-text',
    withText: true,
    why: 'The shape the product is actually written in: two boxes with text around and between them share one line, in order.',
    tree: root([
      'before ',
      box('mid', 40, 20),
      ' between ',
      box('after', 40, 20),
      ' end',
    ]),
  },
  {
    /*
     * The elision boundary. A block container whose children are all inline
     * needs no anonymous box (CSS2 9.2.1.1); one that MIXES block and inline
     * needs one around each run. These five pin both sides of that predicate
     * on all three engines.
     */
    name: 'inline-then-block-then-inline',
    withText: true,
    why: 'A block-level child between inline content splits it into separate runs; the boxes either side must land on different lines.',
    tree: root([
      'before ',
      box('first', 40, 20),
      {tag: 'div', m: 'blocked', style: {height: '20px'}},
      box('second', 40, 20),
      ' after',
    ]),
  },
  {
    name: 'container-padding-offsets-the-run',
    why: 'The run is laid out in the container CONTENT box, so padding moves the first box by exactly the padding.',
    // `boxSizing: 'border-box'` matches React Native's default, so the case
    // measures padding rather than the box-sizing difference.
    tree: root([box('a', 40, 20), box('b', 40, 20)], {
      padding: '10px',
      boxSizing: 'border-box',
    }),
  },
  {
    name: 'absolute-child-among-inline-content',
    why: 'An out-of-flow child generates no in-flow box, so the inline run around it stays one run.',
    tree: root([
      box('a', 40, 20),
      {
        // Not measured: an absolutely-positioned box with no positioned
        // ancestor resolves against the page on the web and against its
        // parent in React Native. What this case pins is that it generates no
        // in-flow box, so `a` and `b` stay on one line.
        tag: 'div',
        style: {
          position: 'absolute',
          left: '0px',
          top: '60px',
          width: '10px',
          height: '10px',
        },
      },
      box('b', 40, 20),
    ]),
  },
  {
    name: 'nested-block-containers-each-all-inline',
    why: 'Each block container establishes its own inline formatting context, so the inner one starts its own line.',
    tree: root([
      box('outer', 40, 20),
      {tag: 'div', m: 'inner', children: [box('nested', 40, 20)]},
    ]),
  },
  {
    name: 'display-none-child-keeps-the-run-contiguous',
    withText: true,
    why: 'A child that generates no box does not interrupt inline content, so the boxes either side share a line.',
    tree: root([
      box('a', 40, 20),
      {tag: 'div', style: {display: 'none'}, children: ['hidden']},
      box('b', 40, 20),
    ]),
  },
  {
    /*
     * Two boxes so the signature asserts a relation: the inline-block shares
     * the first line with the text around it, and the block-level one does
     * not. Found the hard way — a nested <Text> is a Paragraph, block-level
     * like <p>, so writing one between bare strings silently split a
     * paragraph into a layout per run.
     */
    name: 'a-block-child-breaks-the-run',
    withText: true,
    why: 'CSS 2.1 9.2.1.1: a block-level child splits the surrounding inline content, so it starts its own line while an inline-level sibling shares one.',
    tree: root([
      'before ',
      box('inline', 40, 20),
      ' more ',
      box('blocked', 40, 20, {display: 'block'}),
      ' after',
    ]),
  },
  {
    /*
     * Also two boxes — see the note above. One inside the inline element and
     * one after it, so the signature asserts that a box nested in an `<a>` and
     * a box outside it share the line and keep their order. With only the
     * nested box the signature was "mid", which no layout could fail.
     */
    name: 'box-in-inline-with-text',
    withText: true,
    why: 'The <a><img></a> shape: a box inside the inline element shares a line with one after it, in order.',
    tree: root([
      'see ',
      span(['link ', box('mid', 40, 20), ' end']),
      ' then ',
      box('after', 40, 20),
      ' done',
    ]),
  },
  {
    /*
     * A box's position must not depend on how the text BEFORE it is encoded.
     *
     * Both rows render the same four accented letters. The first spells them
     * with precomposed U+00E9, one UTF-16 unit each; the second with "e" plus
     * combining U+0301, two units each. Same glyphs, same advance, same
     * picture — but the second row's box sits at character index 8 where the
     * first's sits at 4, while BOTH sit at glyph index 4.
     *
     * That gap is the point. iOS positions an atomic inline with
     * `boundingRectForGlyphRange:`, which takes a GLYPH range, and the call
     * site passes the CHARACTER range the attribute enumeration handed it. The
     * two indices coincide for plain BMP text, which is why this has never
     * shown up; they stop coinciding at the first combining mark, surrogate
     * pair or ligature, and then the box is placed from some other glyph's
     * rect — or from none, when the index runs past the end.
     *
     * Asserted as an equality between the two rows rather than against
     * Safari's numbers, because an accented glyph's advance is a fact about a
     * font: the coordinate differs legitimately per engine, while "these two
     * encodings agree" must hold in every engine, including Safari. `sameX`
     * checks it on the device AND on the oracle, so a font that genuinely
     * rendered the two differently would fail loudly here rather than quietly
     * becoming the standard.
     *
     * Fantom cannot see this one — it never runs TextKit — which is exactly
     * why it lives in the device corpus.
     */
    name: 'encoding-does-not-move-a-box',
    withText: true,
    sameX: [['plain', 'combining']],
    why: 'Precomposed vs combining-mark text of identical appearance must put the following box in the same place; the two differ in character count but not in glyph count.',
    tree: root([
      {
        tag: 'div',
        m: 'row-plain',
        style: {},
        children: ['\u00e9\u00e9\u00e9\u00e9', box('plain', 40, 20)],
      },
      {
        tag: 'div',
        m: 'row-combining',
        style: {},
        children: ['e\u0301e\u0301e\u0301e\u0301', box('combining', 40, 20)],
      },
    ]),
  },
  {
    /*
     * A run of spaces is one space (css-text-3 §3).
     *
     * `white-space: normal` collapses every run of collapsible whitespace to a
     * single space, so the box after three spaces must land exactly where the
     * box after one space lands. The comparison report recorded the opposite —
     * that source whitespace was preserved and a `<nav>` separated by three
     * literal spaces came out wider than the browser's — so this pins the
     * answer instead of leaving it to a screenshot.
     *
     * `sameX` rather than Safari's coordinate, for the usual reason: where the
     * box lands depends on the width of "ab" in whatever font, while "one space
     * and three spaces agree" holds in every engine including Safari.
     */
    name: 'a-run-of-spaces-is-one-space',
    withText: true,
    sameX: [['one', 'three']],
    why: 'A run of collapsible whitespace collapses to a single space, so both rows place their box identically.',
    tree: root([
      {
        tag: 'div',
        m: 'row-one',
        style: {},
        children: ['ab ', box('one', 40, 20)],
      },
      {
        tag: 'div',
        m: 'row-three',
        style: {},
        children: ['ab   ', box('three', 40, 20)],
      },
    ]),
  },
  {
    /*
     * A raised or lowered run must not change the line's interior rhythm —
     * and its box must RESERVE the shifted ink at its edges.
     *
     * This is a DELIBERATE deviation and the case exists to hold both
     * halves of it. Safari grows the line box to contain a shifted run —
     * measured on `x<sup>2</sup>y` at `line-height: 20px`, its paragraph is
     * 30.53 tall — so a paragraph loses its rhythm wherever a footnote
     * marker appears. Both platforms shift the baseline within the line
     * instead, which is the native text stacks' behaviour and the better
     * typographic result. The ink that shift pushes past the line's edge is
     * then reserved at the RUN BOX's edges (half the shifted fragment's font
     * size per side — SpecDeviations.md), because without the reserve a
     * superscript on the box's first line painted over whatever sat above
     * the element.
     *
     * It also guards the SIZE, which is the browser's and is not deviated
     * from. `<sup>` was rendering near half the body size on iOS because
     * `kCTSuperscriptAttributeName` reduces the font on top of the user-agent
     * sheet's `font-size: 0.8333em` — two reductions for the one the web
     * applies. iOS now takes only the shift from the platform. A regression
     * there shows up here through the reserve, which is sized from the
     * fragment's font.
     */
    name: 'a-shifted-run-does-not-grow-the-line',
    withText: true,
    bounded: 'line-height-unchanged-by-shift',
    why: 'A <sup> shifts within the line (rhythm kept, unlike Safari growing to 30.53) and the run box reserves the shifted ink at its edges.',
    tree: root([
      'x',
      {tag: 'sup', m: 'sup', style: {}, children: ['2']},
      'y',
      {tag: 'sub', m: 'sub', style: {}, children: ['3']},
      'z',
    ]),
  },

  /* ------------------------------------------------------- em and rem -- */
  /*
   * `em` and `rem` are font-relative, and this corpus deliberately refuses to
   * compare anything a font decides. These cases work anyway because they
   * measure MARGINS: a margin stated in `em` is `factor × the element's own
   * computed font-size`, and both operands are numbers CSS fixes exactly. No
   * ascent, descent or advance width takes part, so Safari's coordinates are
   * pinnable to the pixel like every other case here.
   *
   * Every case ends with a zero-margin box, so the margin under test is always
   * an INTERIOR gap between two siblings. Adjacent siblings collapse to the
   * larger of the two margins (CSS 2.1 §8.3.1), and a zero-margin neighbour
   * makes that `max(m, 0) = m` — the margin itself, isolated. Without the
   * spacer the last gap is the container's bottom edge instead, which is a
   * different question and has a case of its own.
   *
   * Each case states the base it resolves against, never inheriting it from
   * the document. That is not tidiness: the root font size is 16px in Safari
   * and the PLATFORM's body size on a device — 17 on iOS, 16 on Android
   * (`DOM-CSS-DEVIATION(root-font-size-is-native-not-16px)`) — so a case that
   * leant on the root would disagree across engines for the one reason that is
   * not a bug. `rem` has no such option, which is why the `rem` cases below
   * compare two of their own boxes rather than naming a number.
   */
  {
    name: 'em-margin-resolves-against-the-elements-own-size',
    bounded: 'gap-checks',
    gapChecks: gap => exactGaps(gap, 20, [
      ['before', 'measured'],
      ['measured', 'after'],
    ]),
    why: 'A margin in `em` is a multiple of the element\'s own computed font-size, so a 20px element with `margin-block: 1em` is pushed 20px down (css-values-4 5.1.1).',
    tree: root(
      [
        marginBox('before', 40, 20),
        marginBox('measured', 40, 20, {
          display: 'block',
          fontSize: '20px',
          marginBlock: '1em',
        }),
        marginBox('after', 40, 20),
      ],
      {fontSize: '50px'},
    ),
  },
  {
    name: 'em-margin-ignores-the-inherited-size',
    bounded: 'gap-checks',
    gapChecks: gap => exactGaps(gap, 20, [
      ['before', 'measured'],
      ['measured', 'after'],
    ]),
    why: 'The SAME tree under a different inherited size. The element states its own 20px, so both cases must place `measured` identically — an `em` resolved against the inherited size instead would move by 30px.',
    tree: root(
      [
        marginBox('before', 40, 20),
        marginBox('measured', 40, 20, {
          display: 'block',
          fontSize: '20px',
          marginBlock: '1em',
        }),
        marginBox('after', 40, 20),
      ],
      {fontSize: '10px'},
    ),
  },
  {
    name: 'em-margin-follows-a-size-stated-in-em',
    bounded: 'gap-checks',
    gapChecks: gap => exactGaps(gap, 30, [
      ['before', 'measured'],
      ['measured', 'after'],
    ]),
    why: 'The element sizes itself in `em` too: 30px inherited, `font-size: 2em` makes it 60, and `margin-block: 0.5em` is then 30. The two `em`s multiply different sizes one step apart, which is the case a single-base implementation gets wrong.',
    tree: root(
      [
        marginBox('before', 40, 20),
        marginBox('measured', 40, 20, {
          display: 'block',
          fontSize: '2em',
          marginBlock: '0.5em',
        }),
        marginBox('after', 40, 20),
      ],
      {fontSize: '30px'},
    ),
  },
  {
    name: 'em-margin-scales-with-the-inherited-size',
    bounded: 'gap-checks',
    gapChecks: gap => exactGaps(gap, 40, [
      ['before', 'measured'],
      ['measured', 'after'],
    ]),
    why: 'The element states no size, so its computed size is the inherited 40px and `margin-block: 1em` is 40 — four times the 10px case above, from one declaration.',
    tree: root(
      [
        marginBox('before', 40, 20),
        marginBox('measured', 40, 20, {
          display: 'block',
          marginBlock: '1em',
        }),
        marginBox('after', 40, 20),
      ],
      {fontSize: '40px'},
    ),
  },
  {
    name: 'rem-margin-is-one-size-for-the-whole-tree',
    bounded: 'gap-checks',
    gapChecks: gap => {
      // Every gap here is one `rem`, so they must all be EQUAL — and that is
      // all this case may assert. The number itself is the root font size,
      // 16 in a browser and the platform's body size on a device
      // (`DOM-CSS-DEVIATION(root-font-size-is-native-not-16px)`), so pinning
      // it to Safari's 16 would fail on iOS's 17 for the one reason that is
      // not a bug.
      const first = gap('before', 'small');
      const problems = [];
      if (!(first > 0)) {
        problems.push(`the first rem margin is ${first}, not a real gap`);
      }
      for (const [a, b] of [
        ['small', 'gap'],
        ['gap', 'large'],
        ['large', 'after'],
      ]) {
        if (Math.abs(gap(a, b) - first) > GAP_TOLERANCE) {
          problems.push(
            `${a}→${b} is ${gap(a, b)} but ${'before'}→small is ${first}; ` +
              'one rem must be one number whatever the element states',
          );
        }
      }
      return problems;
    },
    why: 'Two elements at 8px and 64px, both `margin-block: 1rem`: `rem` names the root, so both margins are equal — the property that separates it from `em`, asserted without naming the root\'s number, which differs per engine by design.',
    tree: root(
      [
        marginBox('before', 40, 20),
        marginBox('small', 40, 20, {
          display: 'block',
          fontSize: '8px',
          marginBlock: '1rem',
        }),
        // Zero-margin spacers, because adjacent siblings COLLAPSE to the
        // larger of the two margins (CSS 2.1 §8.3.1). Without one between
        // them, the gap reported is `max(small's bottom, large's top)` and
        // says nothing about either on its own — which is exactly how the
        // first draft of this case read 64 where it meant 16.
        marginBox('gap', 40, 20),
        marginBox('large', 40, 20, {
          display: 'block',
          fontSize: '64px',
          marginBlock: '1rem',
        }),
        marginBox('after', 40, 20),
      ],
      {fontSize: '30px'},
    ),
  },
  {
    name: 'em-and-rem-differ-on-the-same-element',
    bounded: 'gap-checks',
    gapChecks: gap => {
      const viaRem = gap('before', 'viaRem');
      const viaEm = gap('gap', 'viaEm');
      const problems = [];
      // The `em` side IS pinnable: the element states `font-size: 64px`, so
      // `1em` is 64 in every engine and nothing about the root takes part.
      if (Math.abs(viaEm - 64) > GAP_TOLERANCE) {
        problems.push(`em margin is ${viaEm}, not 1em of the stated 64px`);
      }
      // The `rem` side is the root's size, which differs per engine by design
      // — so the only thing to assert is that it is NOT the em's answer.
      if (Math.abs(viaRem - viaEm) <= GAP_TOLERANCE) {
        problems.push(
          `rem margin ${viaRem} equals the em margin ${viaEm}; on an element ` +
            'at 64px they must differ, and matching is exactly what `em` ' +
            'implemented as `rem` produces',
        );
      }
      if (!(viaRem > 0)) {
        problems.push(`rem margin is ${viaRem}, not a real gap`);
      }
      return problems;
    },
    why: 'Two elements at the same 64px, one with an `em` margin and one with a `rem`: the first is pushed by 64 and the second by the root\'s size. This is the case that fails when `em` is implemented as `rem` — every other case here passes under that bug.',
    tree: root(
      [
        marginBox('before', 40, 20),
        marginBox('viaRem', 40, 20, {
          display: 'block',
          fontSize: '64px',
          marginBlock: '1rem',
        }),
        marginBox('gap', 40, 20),
        marginBox('viaEm', 40, 20, {
          display: 'block',
          fontSize: '64px',
          marginBlock: '1em',
        }),
        marginBox('after', 40, 20),
      ],
      {fontSize: '30px'},
    ),
  },
  {
    name: 'margin-collapses-out-of-a-block-containers-bottom-edge',
    why: 'A block container\'s last child\'s bottom margin collapses THROUGH its bottom edge (CSS 2.1 8.3.1), so the container measures as if the margin were outside it — 60, not 80.',
    /*
     * Compared as a whole rect, deliberately, because the container's HEIGHT
     * is the thing under test and nothing else in the corpus asserts it.
     *
     * This case began life as a recorded limitation: the renderer measured 80
     * where Safari measured 60, and it looked like collapse-through was
     * missing. It was not. A block box that is a FLEX ITEM establishes an
     * independent formatting context and margins correctly do not collapse
     * through it — and React Native's surface root is a flex container, so the
     * corpus was rendering a flex item here and a block child in the browser.
     * Asked directly, Safari measures the identical markup at 80 under a flex
     * parent and 60 under a block one, which is what this renderer does too.
     *
     * The fix was the harness: every case now sits inside a block container on
     * the device side (see `Case` in gen-device-screen.js). This case is what
     * holds that, since it is the only one whose answer depends on it.
     */
    tree: root([
      marginBox('before', 40, 20),
      marginBox('measured', 40, 20, {
        display: 'block',
        marginBlock: '20px',
      }),
      marginBox('after', 40, 20),
    ]),
  },
];

/* ------------------------------------------------------------------ HTML -- */

function styleToCss(style) {
  return Object.entries(style ?? {})
    .map(([k, v]) => `${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}:${v}`)
    .join(';');
}

function toHTML(node) {
  if (typeof node === 'string') {
    return node;
  }
  const attrs = [];
  const css = styleToCss(node.style);
  if (css !== '') {
    attrs.push(`style="${css}"`);
  }
  if (node.m != null) {
    attrs.push(`data-m="${node.m}"`);
  }
  const children = (node.children ?? []).map(toHTML).join('');
  return `<${node.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>${children}</${node.tag}>`;
}

/* -------------------------------------------------- native translation -- */

/*
 * The corpus is written in CSS, so every target renders it in its own spelling.
 * This is React Native's, and it lives HERE — beside the corpus — because it
 * used to live in three places and they drifted.
 *
 * The drift was not theoretical: `gen-device-screen.js` learned to translate
 * `em` and `rem`, `Conformance-itest.js` did not, and the Fantom loop reported
 * six clean failures for a feature that was working — the styles it built
 * carried the strings straight through, so nothing had a margin at all. One
 * corpus, one translation, emitted into the generated screen from this same
 * source.
 *
 * A length in px becomes the number a React Native style takes. A length in em
 * or rem becomes the FACTOR property the renderer resolves — the only channel
 * that can carry one, because a React Native style value is a resolved number,
 * and at the moment a style is written there is no font size to resolve
 * against.
 *
 * DOM-CSS-LIMITATION(no-author-facing-em-lengths): an author's margin-block in
 * em is translated into uaMarginBlockEm, which is the USER-AGENT origin rather
 * than the author's. Nothing in this corpus competes for those margins, so the
 * geometry under test is unaffected — but the two are not the same
 * declaration, and a case that turned on the cascade's origins would have to
 * say so rather than lean on this.
 *
 * Written without template literals on purpose: it is emitted verbatim into a
 * generated file, from inside one.
 */
function toStyle(css) {
  const out = {};
  for (const [key, value] of Object.entries(css ?? {})) {
    const relative =
      typeof value === 'string'
        ? /^(-?\d+(?:\.\d+)?)(em|rem)$/.exec(value)
        : null;
    if (relative != null) {
      const factor = parseFloat(relative[1]);
      const unit = relative[2] === 'em' ? 'Em' : 'Rem';
      if (key === 'fontSize') {
        out['fontSize' + unit] = factor;
      } else if (key === 'marginBlock') {
        out['uaMarginBlock' + unit] = factor;
      } else {
        throw new Error(
          key +
            ': ' +
            value +
            ' — no channel carries a relative length for this property; see ' +
            'DOM-CSS-LIMITATION(no-author-facing-em-lengths)',
        );
      }
    } else if (typeof value === 'string' && /^-?\d+(\.\d+)?px$/.test(value)) {
      out[key] = parseFloat(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/* ----------------------------------------------------------- relative -- */

/*
 * The vertical gap between two measured boxes, as a case's own checks see it.
 *
 * `bounded: 'gap-checks'` exists for the values that differ between engines
 * BY DESIGN — everything resolved from the root font size, which is 16px in a
 * browser and the platform's body size on a device. Pinning those to Safari's
 * number would fail on iOS for the one reason that is not a bug, and dropping
 * the cases would leave `rem` untested. So the case states what survives the
 * root changing, which is also what the spec actually says: that every `rem`
 * in a tree is the same number, and that it is not the same number as `em` on
 * an element the root's size does not describe.
 */

/*
 * Every listed gap is exactly `want`, to the device's pixel rounding.
 *
 * For the `em` cases, whose base is a font size the element STATES in px — so
 * the answer is one number in every engine, and the case can name it.
 */
function exactGaps(gap, want, pairs) {
  const problems = [];
  for (const [a, b] of pairs) {
    if (Math.abs(gap(a, b) - want) > GAP_TOLERANCE) {
      problems.push(a + '→' + b + ' is ' + gap(a, b) + ', not ' + want);
    }
  }
  return problems;
}

function gapReader(rects) {
  return (a, b) => {
    const first = rects[a];
    const second = rects[b];
    if (first == null || second == null) {
      throw new Error(`gap(${a}, ${b}): one of those boxes reported no rect`);
    }
    return Number((second.y - (first.y + first.height)).toFixed(3));
  };
}

/*
 * Run a case's own checks against one engine's rects, and return the problems.
 *
 * Used on Safari as well as on the devices. A case that is wrong about the spec
 * must not become the standard the native engines are held to, and the cheapest
 * way to find out is to hold the browser to it first.
 */
function runGapChecks(testCase, rects) {
  if (testCase.gapChecks == null) {
    return [];
  }
  return testCase.gapChecks(gapReader(rects));
}

module.exports = {CASES, toHTML, styleToCss, runGapChecks, toStyle};
