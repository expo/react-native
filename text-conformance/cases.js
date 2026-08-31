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


/*
 * Reading order for the corpus, as sections.
 *
 * The device screen is 134 cases long and was one undifferentiated scroll, so
 * finding "the float ones" meant reading every label on the way past. These
 * are the groups the corpus already had as banner comments in this file, cut
 * finer where a group had grown large enough to hide things.
 *
 * Presentation only: every comparison is keyed by case NAME, in `verify.js`
 * and in the Fantom runner alike, so grouping changes what is on the screen
 * and nothing about what is checked.
 */
const SECTIONS = [
  ['Writing direction', /^(an-)?rtl-/],
  ['Text alignment', /text-align|^vertical-align-does-not-move/],
  ['Margin collapsing', /collapse|collapses|^adjacent-siblings|^negative-and-positive|^two-negative-margins|^a-negative-top-margin|^padding-stops|^a-border-stops|^an-empty-block/],
  ['Floats and clearance', /float|^clear/],
  ['Positioning', /^(an-)?absolute|^absolute-|^relative-|^a-relative-|^opposite-offsets/],
  ['display: contents', /^contents-|display-contents/],
  ['Box model and sizing', /^(a-)?(percentage|max-|min-|nested-percentage)|border-box|content-box|aspect-ratio|^a-block-container-ignores-gap|^an-auto-width|^auto-inline-margins|^one-auto-inline-margin|^a-negative-inline-margin|^percentage-|^min-width|^min-height|^max-height/],
  ['em and rem', /^(em|rem)-|^em-and-rem/],
  ['Inline formatting', /./],
];

/** The section a case is shown under. Falls through to inline formatting. */
function sectionFor(name) {
  for (const [title, pattern] of SECTIONS) {
    if (pattern.test(name)) {
      return title;
    }
  }
  return SECTIONS[SECTIONS.length - 1][0];
}

const CASES = [
  /* ------------------------------------- PROBE batch 2 -- */
  {
    name: 'PROBE-text-align-center-centres-the-line',
    why: 'text-align centres the line box contents, not the container.',
    deviceOnly: "Fantom's measurer places every line at the container's inline start, so it cannot answer where a line is aligned",
    tree: root([box('a', 40, 20), box('b', 60, 20)], {textAlign: 'center'}),
  },
  {
    name: 'PROBE-text-align-right-packs-to-the-end',
    compositeX: true,
    why: 'text-align:right puts the line contents against the inline end.',
    deviceOnly: "Fantom's measurer places every line at the container's inline start, so it cannot answer where a line is aligned",
    tree: root([box('a', 40, 20), box('b', 60, 20)], {textAlign: 'right'}),
  },
  {
    name: 'text-align-does-not-move-a-block-child',
    compositeX: true,
    why: 'text-align aligns the contents of a LINE box. A block-level child is not on a line, so it fills the container and stays at the inline start — the horizontal twin of vertical-align-does-not-move-a-block-child.',
    deviceOnly: "Fantom's measurer places every line at the container's inline start, so it cannot answer where a line is aligned",
    tree: root([
      {tag: 'div', m: 'blockChild', style: {display: 'block', height: '20px', backgroundColor: '#0a84ff'}},
      box('inlineBox', 40, 20),
    ], {textAlign: 'right'}),
  },
  {
    name: 'text-align-inherits-into-a-nested-block',
    compositeX: true,
    why: 'text-align is inherited, so a nested block container with no value of its own aligns its line the way the ancestor does.',
    deviceOnly: "Fantom's measurer places every line at the container's inline start, so it cannot answer where a line is aligned",
    tree: root([
      {tag: 'div', m: 'nested', style: {display: 'block', backgroundColor: '#e5e5ea'},
       children: [box('inlineBox', 40, 20)]},
    ], {textAlign: 'right'}),
  },
  {
    name: 'PROBE-border-box-keeps-padding-inside-the-width',
    why: 'box-sizing:border-box makes the declared width include padding, so the content box shrinks.',
    tree: root([
      {tag: 'div', m: 'outer', style: {boxSizing: 'border-box', width: '200px', paddingLeft: '30px', paddingRight: '30px', display: 'block'},
       children: [marginBox('inner', 999, 20, {display: 'block', width: 'auto'})]},
    ]),
  },
  {
    name: 'PROBE-display-contents-child-joins-the-parent-flow',
    why: 'display:contents removes the box, so its children are laid out as if they were the parent\'s.',
    tree: root([
      box('before', 40, 20),
      // No `m`: a display:contents element generates no box, so there is
      // nothing of its own to measure — the browser reports a degenerate rect.
      {tag: 'div', style: {display: 'contents'}, children: [box('inner', 40, 20)]},
      box('after', 40, 20),
    ]),
  },
  {
    name: 'contents-with-block-children-stacks-them-in-the-outer-flow',
    why: 'The case above covers inline children. A display:contents wrapper holding BLOCK children is the other half: they stack in the grandparent\'s flow, so a run before them is broken exactly as if the wrapper were not written.',
    tree: root([
      box('before', 40, 20),
      {tag: 'div', style: {display: 'contents'}, children: [
        {tag: 'div', m: 'first', style: {display: 'block', height: '20px', backgroundColor: '#0a84ff'}},
        {tag: 'div', m: 'second', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
      ]},
    ]),
  },
  {
    name: 'margins-collapse-through-a-contents-wrapper',
    why: 'A display:contents element generates no box, so there is no edge for margins to stop at: its child\'s top margin collapses with the preceding sibling\'s bottom margin as though they were siblings.',
    tree: root([
      {tag: 'div', m: 'before', style: {display: 'block', height: '20px', marginBottom: '30px', backgroundColor: '#0a84ff'}},
      {tag: 'div', style: {display: 'contents'}, children: [
        {tag: 'div', m: 'inner', style: {display: 'block', height: '20px', marginTop: '20px', backgroundColor: '#34c759'}},
      ]},
    ]),
  },
  {
    /*
     * An inline-block's baseline is normally the baseline of its last line
     * box. When its overflow is not `visible` it is the bottom MARGIN EDGE
     * instead (CSS2 10.8.1), so the box sits higher on the line — its bottom
     * rests on the baseline rather than hanging below it by its text's
     * descent.
     *
     * Both boxes carry the same text so the only difference between them is
     * `overflow`, and they share a line so they share a baseline. An earlier
     * version of this case used EMPTY boxes, where the rule cannot apply at
     * all: with no in-flow line boxes the baseline is the bottom margin edge
     * whatever `overflow` says, and Safari measures the two identically. It
     * passed everywhere while adjudicating nothing.
     */
    name: 'overflow-hidden-inline-block-aligns-by-its-bottom-margin-edge',
    bounded: 'clipped-sits-above-unclipped',
    fontDependent:
      'How far the unclipped box hangs below the baseline is its text\'s ' +
      'descent, a font metric — Safari puts it 24pt lower. The SIGN is what ' +
      'CSS fixes, and that is what is asserted.',
    why: "An inline-block whose overflow is not visible takes its bottom margin edge as its baseline, so it sits higher on the line than an identical one that does not clip.",
    tree: root([
      {tag: 'span', m: 'plain', style: {display: 'inline-block', width: '40px', height: '40px', backgroundColor: '#0a84ff'}, children: ['Ag']},
      {tag: 'span', m: 'clipped', style: {display: 'inline-block', overflow: 'hidden', width: '40px', height: '40px', backgroundColor: '#34c759'}, children: ['Ag']},
    ]),
  },
  {
    name: 'PROBE-percentage-width-resolves-against-the-container',
    why: 'A percentage width resolves against the containing block content box.',
    tree: root([
      marginBox('half', 999, 20, {display: 'block', width: '50%'}),
    ]),
  },
  {
    name: 'PROBE-max-width-caps-a-block',
    why: 'max-width caps a block that would otherwise fill its container.',
    tree: root([
      marginBox('capped', 999, 20, {display: 'block', width: 'auto', maxWidth: '120px'}),
    ]),
  },

  /* --------------------------------- sizing, position and contexts -- */
  /*
   * Rules the rest of the corpus does not reach: what clamps a box's size,
   * what a relative offset does to its siblings, which box a percentage
   * padding resolves against, and what stops a margin collapsing.
   */
  {
    name: 'auto-inline-margins-centre-a-block',
    why: 'A block-level box with a definite width and both inline margins auto takes the leftover space equally (CSS2 §10.3.3) — `margin: 0 auto`.',
    tree: root([
      marginBox('centred', 200, 20, {display: 'block', marginLeft: 'auto', marginRight: 'auto'}),
    ]),
  },
  {
    name: 'one-auto-inline-margin-takes-all-the-leftover',
    why: 'With only the start margin auto, it absorbs the whole leftover and the box sits against the end edge.',
    tree: root([
      marginBox('pushed', 200, 20, {display: 'block', marginLeft: 'auto'}),
    ]),
  },
  {
    name: 'a-percentage-min-height-against-an-auto-parent-does-not-apply',
    why: 'A percentage min-height resolves against the containing block height; with that auto it does not apply (CSS2 §10.7).',
    tree: root([
      {tag: 'div', m: 'parent', style: {display: 'block', backgroundColor: '#ff9500'},
       children: [marginBox('child', 100, 20, {display: 'block', minHeight: '50%'})]},
    ]),
  },
  {
    name: 'relative-percentage-offset-resolves-against-the-container',
    why: 'A percentage `left` on a relatively positioned box resolves against the containing block WIDTH.',
    tree: root([
      marginBox('shifted', 100, 20, {display: 'block', position: 'relative', left: '10%'}),
    ]),
  },
  {
    name: 'a-relative-box-given-both-left-and-right-uses-left',
    why: 'Relative offsets on opposite sides are over-constrained: one is ignored, and in a left-to-right container it is `right` (CSS2 §9.4.3). The box moves right by the LEFT value, not by the difference.',
    tree: root([
      marginBox('shifted', 100, 20, {display: 'block', position: 'relative', left: '30px', right: '10px'}),
    ]),
  },
  {
    name: 'a-relative-box-given-both-top-and-bottom-uses-top',
    why: 'The block-axis twin: `bottom` is the one ignored, so the box moves down by the TOP value and its siblings do not move at all.',
    tree: root([
      marginBox('shifted', 100, 20, {display: 'block', position: 'relative', top: '15px', bottom: '5px'}),
      {tag: 'div', m: 'after', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
    ]),
  },
  {
    name: 'a-percentage-top-offset-resolves-against-the-container-height',
    why: 'Unlike `left`, a percentage `top` resolves against the containing block HEIGHT — so it needs a definite one to apply at all.',
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', height: '100px', backgroundColor: '#e5e5ea'},
       children: [marginBox('shifted', 100, 20, {display: 'block', position: 'relative', top: '25%'})]},
    ]),
  },
  {
    name: 'margins-collapse-through-several-empty-siblings',
    why: 'A chain of empty blocks collapses through: the single gap is the largest margin in the chain, not their sum.',
    tree: root([
      marginBox('first', 100, 20, {display: 'block', marginBlockEnd: '10px'}),
      {tag: 'div', style: {display: 'block', marginBlock: '25px'}},
      {tag: 'div', style: {display: 'block', marginBlock: '15px'}},
      marginBox('last', 100, 20, {display: 'block', marginBlockStart: '10px'}),
    ]),
  },
  {
    name: 'vertical-align-does-not-move-a-block-child',
    why: 'vertical-align applies to inline-level boxes and table cells; a block-level child ignores it.',
    tree: root([
      marginBox('a', 100, 20, {display: 'block', verticalAlign: 'bottom'}),
      marginBox('b', 100, 20, {display: 'block'}),
    ]),
  },
  {
    name: 'a-float-and-a-following-block-share-the-band',
    why: 'A float is taken out of flow, so a following in-flow BLOCK box starts at the container edge and overlaps it — only line boxes shorten.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '40px', backgroundColor: '#0a84ff'}},
      marginBox('after', 200, 20, {display: 'block'}),
    ], {overflow: 'hidden'}),
  },
  {
    name: 'rtl-float-inline-start-packs-against-the-right',
    why: 'float:inline-start is the LOGICAL side, so under direction:rtl it packs against the right edge (css-logical-1).',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'inline-start', width: '100px', height: '30px', backgroundColor: '#0a84ff'}},
    ], {direction: 'rtl', overflow: 'hidden'}),
  },
  {
    name: 'rtl-float-inline-end-packs-against-the-left',
    why: 'The mirror of the case above: under direction:rtl an inline-end float packs against the LEFT edge.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'inline-end', width: '100px', height: '30px', backgroundColor: '#34c759'}},
    ], {direction: 'rtl', overflow: 'hidden'}),
  },
  {
    name: 'an-rtl-float-is-inset-by-the-containers-padding',
    why: "A float's inline position is measured from the container's content edge, so the padding on the side it packs against insets it — under rtl that is the RIGHT padding for an inline-start float.",
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'inline-start', width: '100px', height: '30px', backgroundColor: '#af52de'}},
    ], {direction: 'rtl', overflow: 'hidden', boxSizing: 'border-box', paddingLeft: '15px', paddingRight: '25px'}),
  },
  {
    name: 'rtl-places-a-block-child-from-the-right',
    why: 'Under direction:rtl a block child with a definite width sits against the inline start, which is the RIGHT edge (css-writing-modes-4 §2).',
    tree: root([
      marginBox('child', 100, 20, {display: 'block'}),
    ], {direction: 'rtl'}),
  },
  {
    name: 'an-absolute-child-positions-from-the-padding-box',
    why: 'An absolutely positioned child offsets from its containing block PADDING box, so the container padding is included (CSS2 §10.1).',
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', boxSizing: 'border-box', padding: '10px', height: '60px', backgroundColor: '#30b0c7'},
       children: [
         {tag: 'div', m: 'abs', style: {position: 'absolute', top: '5px', left: '5px', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
       ]},
    ]),
  },
  /*
   * The rest of absolute positioning inside a BLOCK container. Two cases
   * reached it before, both with `top`/`left` stated. What was never asked is
   * what happens when an offset is omitted — the static position (CSS2 §10.6.4)
   * — and that is the rule a block container has to answer for itself, since
   * the position it hands back is the one the child would have had in the flow.
   */
  {
    name: 'an-absolute-child-with-no-offsets-sits-at-its-static-position',
    why: 'With every offset auto, an absolutely positioned box stays where it would have been in the flow (CSS2 §10.6.4) — so it sits below the block box before it, not at the top of the container.',
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', height: '100px', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'first', style: {height: '30px', backgroundColor: '#0a84ff'}},
         {tag: 'div', m: 'abs', style: {position: 'absolute', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
       ]},
    ]),
  },
  {
    name: 'an-absolute-child-offsets-from-the-bottom-and-right',
    why: 'bottom and right offset from the containing block\'s padding box on the far side, so the box is placed by its own bottom-right corner.',
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', boxSizing: 'border-box', padding: '10px', height: '100px', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'abs', style: {position: 'absolute', bottom: '5px', right: '5px', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
       ]},
    ]),
  },
  {
    name: 'opposite-offsets-size-an-auto-width-absolute-box',
    why: 'With left and right both given and width auto, the box stretches between them (CSS2 §10.3.7) rather than shrinking to fit.',
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', height: '60px', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'abs', style: {position: 'absolute', left: '20px', right: '50px', height: '20px', backgroundColor: '#ff3b30'}},
       ]},
    ]),
  },
  {
    name: 'an-absolute-child-does-not-take-space-in-the-flow',
    why: 'An out-of-flow box contributes nothing to its container\'s block size, so the box after it sits where it would with the absolute one absent.',
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'first', style: {height: '20px', backgroundColor: '#0a84ff'}},
         {tag: 'div', m: 'abs', style: {position: 'absolute', top: '0px', left: '0px', width: '40px', height: '90px', backgroundColor: '#ff3b30'}},
         {tag: 'div', m: 'after', style: {height: '20px', backgroundColor: '#34c759'}},
       ]},
    ]),
  },
  {
    name: 'an-absolute-box-does-not-collapse-margins-with-its-siblings',
    why: "An out-of-flow box's margins never collapse with anything (CSS2 §8.3.1), and it is not between its siblings, so the two in-flow margins collapse with each other straight through it.",
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'first', style: {height: '20px', marginBottom: '30px', backgroundColor: '#0a84ff'}},
         {tag: 'div', m: 'abs', style: {position: 'absolute', width: '40px', height: '20px', marginTop: '100px', backgroundColor: '#ff3b30'}},
         {tag: 'div', m: 'after', style: {height: '20px', marginTop: '20px', backgroundColor: '#34c759'}},
       ]},
    ]),
  },
  {
    name: 'nested-percentage-widths-compound',
    why: 'A percentage width resolves against the parent CONTENT box, so 50% of 50% of 300 is 75.',
    tree: root([
      {tag: 'div', m: 'outer', style: {display: 'block', width: '50%', backgroundColor: '#0a84ff'},
       children: [marginBox('inner', 999, 20, {display: 'block', width: '50%'})]},
    ]),
  },
  {
    name: 'a-percentage-min-width-resolves-against-the-container',
    why: 'A percentage min-width resolves against the containing block width and can widen a narrower box.',
    tree: root([
      marginBox('clamped', 40, 20, {display: 'block', minWidth: '40%'}),
    ]),
  },
  {
    name: 'a-border-reduces-the-content-box-under-border-box',
    why: 'Under box-sizing:border-box the declared width includes the border, so a child filling the container is narrower by both borders.',
    tree: root([
      {tag: 'div', m: 'outer', style: {display: 'block', boxSizing: 'border-box', width: '200px', borderLeftWidth: '15px', borderRightWidth: '15px', borderLeftStyle: 'solid', borderRightStyle: 'solid', borderLeftColor: '#af52de', borderRightColor: '#af52de'},
       children: [marginBox('inner', 999, 20, {display: 'block', width: 'auto'})]},
    ]),
  },
  {
    name: 'a-block-container-ignores-gap',
    why: 'gap applies to flex, grid and multi-column — not to a block container, whose children are separated by their margins alone.',
    tree: root([
      marginBox('first', 100, 20, {display: 'block'}),
      marginBox('second', 100, 20, {display: 'block'}),
    ], {gap: '30px'}),
  },
  {
    name: 'content-box-percentage-padding-resolves-against-the-width',
    why: 'Under box-sizing:content-box the declared width is the CONTENT width and a percentage padding — resolved against the containing block width — adds to it.',
    tree: root([
      {tag: 'div', m: 'padded', style: {display: 'block', boxSizing: 'content-box', width: '100px', height: '20px', paddingLeft: '10%', backgroundColor: '#af52de'}},
    ]),
  },
  {
    name: 'percentage-margin-resolves-against-the-width',
    why: 'A percentage margin resolves against the containing block WIDTH in both axes (CSS2 §8.3), so a 10% top margin on a 300pt container is 30.',
    tree: root([
      marginBox('shifted', 100, 20, {display: 'block', marginTop: '10%'}),
    ]),
  },
  {
    name: 'a-percentage-height-against-an-auto-height-parent-is-auto',
    why: 'A percentage height resolves against the containing block height; when that is auto the percentage does not apply and the box is content-sized (CSS2 §10.5).',
    tree: root([
      {tag: 'div', m: 'parent', style: {display: 'block', backgroundColor: '#30b0c7'},
       children: [marginBox('child', 100, 20, {display: 'block', height: '50%'})]},
    ]),
  },
  {
    name: 'a-percentage-height-against-a-definite-parent-applies',
    why: 'The other half of CSS2 §10.5: once the containing block has a definite height, a percentage height resolves against it.',
    tree: root([
      {tag: 'div', m: 'parent', style: {display: 'block', height: '80px', backgroundColor: '#30b0c7'},
       children: [{tag: 'div', m: 'child', style: {display: 'block', height: '50%', backgroundColor: '#ff3b30'}}]},
    ]),
  },
  {
    name: 'a-percentage-height-resolves-against-the-content-box',
    why: "A percentage height resolves against the containing block's CONTENT height, so the parent's padding is excluded from what the percentage is taken of.",
    tree: root([
      {tag: 'div', m: 'parent', style: {display: 'block', boxSizing: 'content-box', height: '80px', paddingTop: '10px', paddingBottom: '10px', backgroundColor: '#30b0c7'},
       children: [{tag: 'div', m: 'child', style: {display: 'block', height: '50%', backgroundColor: '#ff3b30'}}]},
    ]),
  },
  {
    name: 'a-negative-inline-margin-pulls-a-block-out',
    why: 'A negative inline-start margin moves a block box outside its container content edge.',
    tree: root([
      marginBox('pulled', 100, 20, {display: 'block', marginLeft: '-20px'}),
    ]),
  },
  {
    name: 'clear-both-drops-below-floats-on-both-sides',
    why: 'clear:both puts the box below the lowest edge of floats on either side.',
    tree: root([
      {tag: 'div', m: 'left', style: {float: 'left', width: '80px', height: '30px', backgroundColor: '#0a84ff'}},
      {tag: 'div', m: 'right', style: {float: 'right', width: '80px', height: '50px', backgroundColor: '#34c759'}},
      {tag: 'div', m: 'cleared', style: {clear: 'both', display: 'block', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
    ], {overflow: 'hidden'}),
  },
  /*
   * The one argument `calculateBlockLayout` still passes differently from the
   * flex path: `constrainMaxSizeForMode` gets `ownerWidth` where flex gives it
   * `availableInnerWidth`. Inside, that value resolves the child's PERCENTAGE
   * MARGIN — the same quantity whose own bug was fixed at a different call
   * site — and the result is added to the max size before the clamp. So a
   * child needs BOTH a percentage margin and a max size, under a width-less
   * block that makes the two widths differ, for the difference to show at all.
   */
  {
    name: 'a-max-width-clamps-against-a-percentage-margin',
    why: "A max-width clamps the border box to 150 whatever the margin is. The clamp is applied to the MARGIN box with the margin added back, so a margin resolved against the wrong width would clamp at the wrong place and leave the box wider than its max.",
    tree: root([
      {tag: 'div', m: 'looseParent', style: {display: 'block'},
       children: [
         {tag: 'div', m: 'container', style: {display: 'block', width: '200px', backgroundColor: '#e5e5ea'},
          children: [
            {tag: 'div', m: 'clamped', style: {display: 'block', maxWidth: '150px', marginLeft: '10%', height: '20px', backgroundColor: '#ff3b30'}},
          ]},
       ]},
    ]),
  },
  {
    name: 'a-max-height-clamps-against-a-percentage-margin',
    why: 'The block-axis twin, where a percentage margin still resolves against the WIDTH — so the same wrong base would reach the height clamp.',
    tree: root([
      {tag: 'div', m: 'looseParent', style: {display: 'block'},
       children: [
         {tag: 'div', m: 'container', style: {display: 'block', width: '200px', height: '200px', backgroundColor: '#e5e5ea'},
          children: [
            {tag: 'div', m: 'clamped', style: {display: 'block', height: '180px', maxHeight: '100px', marginTop: '10%', backgroundColor: '#ff3b30'}},
          ]},
       ]},
    ]),
  },
  {
    name: 'min-width-beats-max-width-when-they-conflict',
    why: 'When min-width is larger than max-width, min wins (CSS2 §10.4).',
    tree: root([
      marginBox('conflicted', 40, 20, {display: 'block', minWidth: '180px', maxWidth: '90px'}),
    ]),
  },
  /*
   * `box-sizing` crossed with the min/max clamps. Which box a length names is
   * settled per property, and min/max are not the same property as `width` —
   * so a case stating one does not cover the other. Every case here states
   * `box-sizing` outright: React Native defaults to border-box where CSS
   * defaults to content-box, and leaving it implicit measures that difference
   * instead of the rule.
   */
  {
    name: 'min-width-under-border-box-includes-the-padding',
    why: 'Under border-box every length names the border box, min-width included — so a 120pt min-width on a box with 20pt of padding leaves 80pt of content, not 120.',
    tree: root([
      {tag: 'div', m: 'clamped', style: {display: 'block', boxSizing: 'border-box', width: '40px', minWidth: '120px', height: '30px', paddingLeft: '20px', paddingRight: '20px', backgroundColor: '#0a84ff'},
       children: [{tag: 'div', m: 'inner', style: {display: 'block', height: '10px', backgroundColor: '#ff3b30'}}]},
    ]),
  },
  {
    name: 'min-width-under-content-box-excludes-the-padding',
    why: 'Under content-box the same 120pt min-width names the CONTENT box, so the border box comes out 40pt wider and the inner box is the full 120.',
    tree: root([
      {tag: 'div', m: 'clamped', style: {display: 'block', boxSizing: 'content-box', width: '40px', minWidth: '120px', height: '30px', paddingLeft: '20px', paddingRight: '20px', backgroundColor: '#0a84ff'},
       children: [{tag: 'div', m: 'inner', style: {display: 'block', height: '10px', backgroundColor: '#ff3b30'}}]},
    ]),
  },
  {
    name: 'a-max-height-does-not-move-the-children',
    why: 'A max-height caps the container only. Its children keep the positions the flow gave them and overflow past the capped edge.',
    tree: root([
      {tag: 'div', m: 'capped', style: {display: 'block', maxHeight: '30px', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'first', style: {display: 'block', height: '20px', backgroundColor: '#0a84ff'}},
         {tag: 'div', m: 'second', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
       ]},
    ]),
  },
  {
    name: 'an-auto-width-beats-auto-margins',
    why: 'With width auto, the box fills the container and auto margins become zero (CSS2 §10.3.3) — there is no leftover to share.',
    tree: root([
      marginBox('filled', 999, 20, {display: 'block', width: 'auto', marginLeft: 'auto', marginRight: 'auto'}),
    ]),
  },
  {
    name: 'a-percentage-width-resolves-against-the-content-box',
    why: 'A percentage width resolves against the containing block CONTENT box, so the container padding is excluded from the base.',
    tree: root([
      {tag: 'div', m: 'padded', style: {display: 'block', boxSizing: 'border-box', width: '200px', paddingLeft: '20px', paddingRight: '20px', backgroundColor: '#30b0c7'},
       children: [marginBox('half', 999, 20, {display: 'block', width: '50%'})]},
    ]),
  },
  {
    name: 'float-margins-never-collapse',
    why: 'A float\'s margins never collapse — not with its own, not with its neighbours\' (CSS2 §8.3.1) — so two stacked floats are separated by the SUM of their block margins.',
    tree: root([
      {tag: 'div', m: 'f1', style: {float: 'left', width: '300px', height: '20px', marginBottom: '20px', backgroundColor: '#0a84ff'}},
      {tag: 'div', m: 'f2', style: {float: 'left', width: '300px', height: '20px', marginTop: '30px', backgroundColor: '#34c759'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-float-with-padding-and-border-takes-its-whole-box',
    why: 'A float packs by its MARGIN box, so padding and border widen the space it takes from the line.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', boxSizing: 'content-box', width: '60px', height: '20px', paddingLeft: '10px', paddingRight: '10px', borderLeftWidth: '5px', borderRightWidth: '5px', borderLeftStyle: 'solid', borderRightStyle: 'solid', borderLeftColor: '#af52de', borderRightColor: '#af52de', backgroundColor: '#ff9500'}},
      {tag: 'div', m: 'second', style: {float: 'left', width: '100px', height: '20px', backgroundColor: '#30b0c7'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-percentage-width-float-resolves-against-the-container',
    why: 'A float with a percentage width resolves it against the containing block, like any other box.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '25%', height: '20px', backgroundColor: '#ff3b30'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'opposite-floats-share-one-line',
    why: 'A left and a right float on the same line pack against opposite edges and do not push each other down while they fit.',
    tree: root([
      {tag: 'div', m: 'left', style: {float: 'left', width: '100px', height: '20px', backgroundColor: '#0a84ff'}},
      {tag: 'div', m: 'right', style: {float: 'right', width: '100px', height: '20px', backgroundColor: '#34c759'}},
    ], {overflow: 'hidden'}),
  },
  /*
   * The remaining conditions in CSS2 §8.3.1. The rules that STOP a collapse
   * were covered one at a time (border, padding, `overflow`); the ones below
   * are the conditions on the box's own SIZE, which nothing reached, plus the
   * sign rule for two negatives.
   */
  {
    name: 'a-definite-height-stops-the-bottom-margin-collapsing-out',
    why: "A last child's bottom margin collapses out of its parent only while the parent's height is auto (CSS2 §8.3.1). Given a height, the parent's bottom edge is fixed and the margin stays inside it.",
    tree: root([
      {tag: 'div', m: 'parent', style: {height: '60px', backgroundColor: '#e5e5ea'}, children: [
        {tag: 'div', m: 'child', style: {height: '20px', marginBottom: '30px', backgroundColor: '#0a84ff'}},
      ]},
      {tag: 'div', m: 'after', style: {height: '20px', backgroundColor: '#34c759'}},
    ]),
  },
  {
    name: 'a-min-height-stops-a-block-collapsing-through',
    why: "An empty block collapses through only when its min-height is zero too (CSS2 §8.3.1). A min-height separates its own top and bottom margins, so they no longer collapse with each other.",
    tree: root([
      {tag: 'div', m: 'before', style: {height: '20px', backgroundColor: '#0a84ff'}},
      {tag: 'div', m: 'empty', style: {minHeight: '10px', marginTop: '20px', marginBottom: '20px'}},
      {tag: 'div', m: 'after', style: {height: '20px', backgroundColor: '#34c759'}},
    ]),
  },
  {
    name: 'two-negative-margins-collapse-to-the-most-negative',
    why: 'Collapsing takes the maximum of the positive margins and the minimum of the negative ones, then adds them — so two negatives give the MORE negative of the pair, never their sum.',
    tree: root([
      {tag: 'div', m: 'first', style: {height: '20px', marginBottom: '-10px', backgroundColor: '#0a84ff'}},
      {tag: 'div', m: 'second', style: {height: '20px', marginTop: '-30px', backgroundColor: '#34c759'}},
    ], {paddingTop: '40px'}),
  },
  {
    name: 'auto-margins-do-not-centre-a-float',
    why: "A float's auto margins compute to zero (CSS2 §10.3.5), not to the leftover space, so it packs against the edge rather than centring.",
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '20px', marginLeft: 'auto', marginRight: 'auto', backgroundColor: '#af52de'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-max-width-caps-a-float',
    why: 'max-width applies to a float like any other box, and the capped width is what the next float packs against.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '200px', maxWidth: '80px', height: '20px', backgroundColor: '#ff9500'}},
      {tag: 'div', m: 'second', style: {float: 'left', width: '40px', height: '20px', backgroundColor: '#30b0c7'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-float-is-offset-by-its-own-inline-margin',
    why: "A left float's margin box sits at the content edge, so its border box is inset by its own left margin.",
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '30px', marginLeft: '20px', backgroundColor: '#af52de'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-right-float-is-offset-by-its-own-inline-margin',
    why: 'The same for a right float: its margin box is packed against the end edge, so the border box is inset by its right margin.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'right', width: '100px', height: '30px', marginRight: '20px', backgroundColor: '#30b0c7'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-negative-margin-on-a-float-pulls-it-out',
    why: 'A negative inline margin moves a float outside the container content edge.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '30px', marginLeft: '-20px', backgroundColor: '#0a84ff'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'clear-left-ignores-a-right-float',
    why: 'clear:left drops below left floats only, so a right float beside it is not cleared.',
    tree: root([
      {tag: 'div', m: 'right', style: {float: 'right', width: '80px', height: '50px', backgroundColor: '#34c759'}},
      {tag: 'div', m: 'cleared', style: {clear: 'left', display: 'block', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'min-width-clamps-a-narrower-box',
    why: 'min-width wins over a smaller declared width (CSS2 §10.4).',
    tree: root([
      marginBox('clamped', 40, 20, {display: 'block', minWidth: '120px'}),
    ]),
  },
  {
    name: 'min-height-clamps-a-shorter-box',
    why: 'min-height wins over a smaller declared height.',
    tree: root([
      marginBox('clamped', 100, 10, {display: 'block', minHeight: '50px'}),
    ]),
  },
  {
    name: 'max-height-caps-a-taller-box',
    why: 'max-height caps a declared height.',
    tree: root([
      marginBox('capped', 100, 200, {display: 'block', maxHeight: '40px'}),
    ]),
  },
  {
    name: 'aspect-ratio-sizes-the-axis-that-is-auto',
    why: 'With one axis given, aspect-ratio determines the other (css-sizing-4 §4).',
    tree: root([
      {tag: 'div', m: 'ratio', style: {display: 'block', width: '120px', aspectRatio: '3 / 1', backgroundColor: '#0a84ff'}},
    ]),
  },
  {
    /*
     * The other direction of the ratio: the HEIGHT is definite and the width
     * is derived. It needs a shrink-to-fit context to show, because a
     * block-level box with an auto width in normal flow fills its container
     * and the ratio never reaches the inline axis — so the box sits inside an
     * inline-block, which shrink-wraps to its content.
     */
    name: 'aspect-ratio-sizes-the-width-from-a-definite-height',
    why: 'With the height given and the width shrink-to-fit, aspect-ratio determines the width (css-sizing-4 §4).',
    tree: root([
      {tag: 'span', m: 'wrapper', style: {display: 'inline-block', verticalAlign: 'top'},
       children: [
         {tag: 'div', m: 'ratio', style: {display: 'block', height: '20px', aspectRatio: '2 / 1', backgroundColor: '#0a84ff'}},
       ]},
    ]),
  },
  {
    name: 'relative-offset-does-not-move-the-next-box',
    why: 'A relatively positioned box is offset from where it would have been, and the space it left stays reserved (CSS2 §9.4.3).',
    tree: root([
      marginBox('shifted', 100, 20, {display: 'block', position: 'relative', left: '30px', top: '10px'}),
      marginBox('after', 100, 20, {display: 'block'}),
    ]),
  },
  {
    name: 'percentage-padding-resolves-against-the-width',
    why: 'A percentage padding resolves against the containing block WIDTH in both axes (CSS2 §8.4).',
    tree: root([
      {tag: 'div', m: 'padded', style: {display: 'block', paddingTop: '10%', backgroundColor: '#34c759'}},
    ]),
  },
  {
    name: 'border-box-includes-the-border-in-the-width',
    why: 'box-sizing:border-box makes the declared width include the border, not only the padding.',
    tree: root([
      {tag: 'div', m: 'outer', style: {boxSizing: 'border-box', width: '200px', borderLeftWidth: '20px', borderRightWidth: '20px', borderLeftStyle: 'solid', borderRightStyle: 'solid', borderLeftColor: '#af52de', borderRightColor: '#af52de', display: 'block'},
       children: [marginBox('inner', 999, 20, {display: 'block', width: 'auto'})]},
    ]),
  },
  {
    /*
     * `hidden` is the only value this can be written with. The rule is
     * "overflow other than visible", and the engine tests exactly that — so
     * `scroll` takes the same path — but a browser reserves a scrollbar gutter
     * on a scroll container and a device does not, which put the container at
     * 67 against 50 for reasons that have nothing to do with the collapse. The
     * coordinate this case turns on, the child's y, was 30 either way.
     */
    name: 'overflow-hidden-stops-a-margin-collapsing-through',
    why: 'overflow other than visible establishes a block formatting context, so a child margin cannot collapse out of it (CSS2 §8.3.1).',
    tree: root([
      {tag: 'div', m: 'context', style: {display: 'block', overflow: 'hidden', backgroundColor: '#ff9500'},
       children: [marginBox('child', 100, 20, {display: 'block', marginTop: '30px'})]},
      marginBox('after', 100, 20, {display: 'block'}),
    ]),
  },
  {
    name: 'padding-stops-the-parent-child-collapse',
    why: 'A parent padding separates the two top edges, so the margins do not collapse (CSS2 §8.3.1) — the padding counterpart of the border case above.',
    tree: root([
      {tag: 'div', m: 'parent', style: {display: 'block', paddingTop: '10px', backgroundColor: '#30b0c7'},
       children: [marginBox('child', 100, 20, {display: 'block', marginTop: '40px'})]},
    ]),
  },
  {
    name: 'a-negative-top-margin-pulls-the-box-up',
    why: 'A negative margin moves a block up over its predecessor.',
    tree: root([
      marginBox('first', 100, 40, {display: 'block'}),
      marginBox('second', 100, 20, {display: 'block', marginTop: '-15px'}),
    ]),
  },

  /* ------------------------------------------- margins and floats -- */
  /*
   * Block-level behaviour the rest of the corpus does not reach: what
   * collapsing does between siblings, through an empty box, and when a border
   * separates two edges; and where floats sit, pack and are cleared.
   *
   * Each float case gives its root `overflow: hidden` so the case is its own
   * block formatting context. Without it a float that overflows escapes into
   * the NEXT case on the shared page and moves its boxes — which is what put a
   * left float at x=120 the first time these ran.
   */
  {
    name: 'adjacent-siblings-collapse-to-the-larger',
    why: 'Adjacent siblings collapse to max(20, 30) = 30 (CSS 2.1 8.3.1).',
    tree: root([
      marginBox('a', 40, 20, {display: 'block', marginBlockEnd: '20px'}),
      marginBox('b', 40, 20, {display: 'block', marginBlockStart: '30px'}),
      marginBox('after', 40, 20),
    ]),
  },
  {
    name: 'a-border-stops-the-parent-child-collapse',
    why: 'A border on the parent separates the edges, so the child margin stays inside.',
    tree: root([
      marginBox('before', 40, 20),
      {tag: 'div', m: 'parent', style: {width: '300px', display: 'block', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: '#000'},
       children: [marginBox('child', 40, 20, {display: 'block', marginBlockStart: '25px'})]},
      marginBox('after', 40, 20),
    ]),
  },
  {
    name: 'an-empty-block-collapses-through',
    why: 'An empty block with no border or padding collapses its own margins through, leaving max(20, 30).',
    tree: root([
      marginBox('a', 40, 20),
      {tag: 'div', m: 'empty', style: {display: 'block', marginBlockStart: '20px', marginBlockEnd: '30px'}},
      marginBox('b', 40, 20),
    ]),
  },
  {
    name: 'negative-and-positive-margins-combine',
    why: 'Collapsing adds the largest positive and the most negative: 30 + (-10) = 20.',
    tree: root([
      marginBox('a', 40, 20, {display: 'block', marginBlockEnd: '30px'}),
      marginBox('b', 40, 20, {display: 'block', marginBlockStart: '-10px'}),
      marginBox('after', 40, 20),
    ]),
  },
  {
    name: 'a-float-shrinks-to-fit',
    why: 'A float with auto width takes its content width rather than filling the line. Content narrower than the container, so max-content and fit-content agree — the case beside it is the one that separates them.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', display: 'block'},
       children: [box('inner', 40, 20)]},
      marginBox('after', 40, 20),
    ], {overflow: 'hidden'}),
  },
  {
    /*
     * A float with `width: auto` is SHRINK-TO-FIT: min(max(min-content,
     * available), max-content) (CSS2 §10.3.5). The case beside this one uses a
     * single 40pt box, where max-content and fit-content are both 40 and the
     * distinction cannot show. Here the content is 360 wide in a 300 container,
     * so max-content overflows and shrink-to-fit wraps.
     */
    name: 'a-float-with-auto-width-shrinks-to-the-available-space',
    why: 'A float wider than its container at max-content is capped at the available width and its content wraps.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', display: 'block'},
       children: [box('c1', 120, 20), box('c2', 120, 20), box('c3', 120, 20)]},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'two-floats-pack-then-wrap',
    why: 'Floats pack along the line until one does not fit, then drop below.',
    tree: root([
      {tag: 'div', m: 'f1', style: {float: 'left', width: '120px', height: '20px', backgroundColor: '#0a84ff'}},
      {tag: 'div', m: 'f2', style: {float: 'left', width: '120px', height: '20px', backgroundColor: '#34c759'}},
      {tag: 'div', m: 'f3', style: {float: 'left', width: '120px', height: '20px', backgroundColor: '#ff9500'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'clear-drops-below-the-float',
    why: 'A cleared block sits below the float rather than beside it.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '40px', backgroundColor: '#af52de'}},
      {tag: 'div', m: 'cleared', style: {clear: 'left', display: 'block', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-line-shortens-beside-a-float',
    deviceOnly:
      "Fantom's text layout manager is a model and implements no exclusion " +
      'support, so it reports the run unshortened whatever the engine does. ' +
      'Both devices assert it in verify.js.',
    why: 'The behaviour floats exist for (CSS2 §9.5): a line box overlapping a float shortens beside it, so boxes on the float\'s lines start after it and boxes below it start at the container edge.',
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '120px', height: '40px', backgroundColor: '#af52de'}},
      box('a', 60, 20),
      box('b', 60, 20),
      box('c', 60, 20),
      box('d', 60, 20),
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-plain-block-does-not-contain-its-floats',
    why: 'Only an independent formatting context grows to enclose its floats (CSS2 §10.6.7). A plain block in another block\'s flow reports the height it would have had without them, which is why `overflow: hidden` is the classic way to make a container hold them up.',
    tree: root([
      {tag: 'div', m: 'plain', style: {display: 'block', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '40px', backgroundColor: '#af52de'}},
       ]},
      {tag: 'div', m: 'after', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'a-float-does-not-escape-an-inner-formatting-context',
    why: 'A float is contained by the block formatting context it is in, so one inside an `overflow: hidden` child intrudes on nothing outside it — the box after that child starts below it, not beside the float.',
    tree: root([
      {tag: 'div', m: 'inner', style: {display: 'block', overflow: 'hidden', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '40px', backgroundColor: '#af52de'}},
       ]},
      {tag: 'div', m: 'after', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'floating-an-inline-blockifies-it',
    why: 'A float is block-level whatever `display` says: `inline` computes to `block` (css-display-3 §2.7), so the stated width and height apply where on an inline box they would not.',
    tree: root([
      {tag: 'span', m: 'floated', style: {float: 'left', display: 'inline', width: '100px', height: '30px', backgroundColor: '#af52de'}},
      {tag: 'div', m: 'second', style: {float: 'left', width: '40px', height: '30px', backgroundColor: '#30b0c7'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'absolute-positioning-cancels-float',
    why: "An absolutely positioned box's `float` computes to `none` (CSS2 §9.7), so it is placed by its offsets and intrudes on nothing — the in-flow box beside it starts at the container's edge.",
    tree: root([
      {tag: 'div', m: 'holder', style: {display: 'block', position: 'relative', backgroundColor: '#e5e5ea'},
       children: [
         {tag: 'div', m: 'abs', style: {position: 'absolute', float: 'left', top: '0px', left: '0px', width: '100px', height: '40px', backgroundColor: '#ff3b30'}},
         {tag: 'div', m: 'inflow', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
       ]},
    ]),
  },
  {
    name: 'a-float-can-clear-another-float',
    why: '`clear` applies to a float as much as to an in-flow box (CSS2 §9.5.2), so the second float drops below the first instead of packing beside it — even though there is room.',
    tree: root([
      {tag: 'div', m: 'first', style: {float: 'left', width: '100px', height: '40px', backgroundColor: '#af52de'}},
      {tag: 'div', m: 'second', style: {float: 'left', clear: 'left', width: '40px', height: '20px', backgroundColor: '#ff3b30'}},
    ], {overflow: 'hidden'}),
  },
  {
    name: 'clearance-absorbs-a-smaller-top-margin',
    why: "Clearance is the shortfall between where the box would have been WITH its margin and the float's bottom edge (CSS2 §9.5.2), not a floor the margin is added to — so a 25pt margin under a float ending at 40 lands the border edge at 40, not 65.",
    tree: root([
      {tag: 'div', m: 'floated', style: {float: 'left', width: '100px', height: '40px', backgroundColor: '#af52de'}},
      {tag: 'div', m: 'cleared', style: {clear: 'left', display: 'block', height: '20px', marginTop: '25px', backgroundColor: '#ff3b30'}},
    ], {overflow: 'hidden'}),
  },

  {
    /*
     * `direction: rtl` reverses the inline axis: the line starts at the right
     * edge and boxes are placed leftwards (css-writing-modes-4 §2).
     */
    name: 'rtl-inline-run-starts-at-the-right-edge',
    knownGap:
      'DOM-CSS-LIMITATION(rtl-inline-run-not-reordered) — the run is ' +
      'right-aligned but its boxes keep their logical order. Safari 260/200, ' +
      'both platforms 200/240.',
    why: 'In an RTL block the first box sits against the right edge and the next one to its left.',
    tree: root([box('first', 40, 20), box('second', 60, 20)], {direction: 'rtl'}),
  },
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
    name: 'nowrap-keeps-atomic-inlines-on-one-line',
    compositeX: true,
    why: 'The same four boxes under `white-space: nowrap` stay on one line and overflow the container rather than breaking — the rule holds for atomic inlines, not only for text.',
    tree: root([
      box('a', 100, 20),
      box('b', 100, 20),
      box('c', 100, 20),
      box('d', 100, 20),
    ], {whiteSpace: 'nowrap'}),
  },
  {
    name: 'nowrap-does-not-stop-a-block-child-breaking-the-run',
    why: 'white-space governs breaking WITHIN a line. A block-level child is not on the line at all, so it still ends the run and starts its own.',
    tree: root([
      box('a', 40, 20),
      {tag: 'div', m: 'blockChild', style: {display: 'block', height: '20px', backgroundColor: '#0a84ff'}},
      box('b', 40, 20),
    ], {whiteSpace: 'nowrap'}),
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
    name: 'inline-grid-atomic',
    why: 'display:inline-grid is the inline-level form of grid: it sits on the line like an inline-block rather than starting a new one.',
    tree: root([
      box('before', 40, 20),
      {
        tag: 'span',
        m: 'grid',
        style: {
          display: 'inline-grid',
          width: '80px',
          height: '20px',
          verticalAlign: 'top',
        },
        children: [box('gridchild', 20, 20)],
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
    name: 'vertical-padding-on-an-inline-does-not-grow-the-line',
    why: 'The other half of the rule beside it: vertical padding on a non-replaced inline box is drawn but does not enter the line box height (CSS2 §10.6.1), so neither the line nor the box after it moves.',
    tree: root([
      box('before', 40, 20),
      span([box('inner', 40, 20)], {paddingTop: '15px', paddingBottom: '15px'}),
      {tag: 'div', m: 'nextLine', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
    ]),
  },
  {
    name: 'vertical-margins-on-an-inline-have-no-effect',
    why: 'Vertical margins on a non-replaced inline box do not apply at all (CSS2 §8.3), so the inner box sits exactly where it would without them.',
    tree: root([
      box('before', 40, 20),
      span([box('inner', 40, 20)], {marginTop: '20px', marginBottom: '20px'}),
      {tag: 'div', m: 'nextLine', style: {display: 'block', height: '20px', backgroundColor: '#34c759'}},
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

module.exports = {CASES, SECTIONS, sectionFor, toHTML, styleToCss, runGapChecks, toStyle};
