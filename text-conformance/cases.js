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

module.exports = {CASES, toHTML, styleToCss};
