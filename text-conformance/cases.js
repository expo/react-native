/**
 * The text-layout conformance corpus: mixed inline / block / flex / inline-flex
 * content, and text runs interrupted by block-level children.
 *
 * ONE case list feeds three engines — real Safari (the oracle), iOS, and
 * Android — through `oracle.js` and `verify.js`. A case is a small element
 * tree; every element with an `id` is a probe whose border box is read back
 * with `getBoundingClientRect()`.
 *
 * ## Why the assertions are shaped the way they are
 *
 * Text cannot be pinned to Safari's pixels. The three engines shape with
 * different fonts, hinting and metrics, so "the span is 41.4pt wide here and
 * 43.1pt there" says nothing about correctness. Comparing them fairly needs
 * quantities that do not depend on the font, and there are three kinds:
 *
 * 1. **Structure.** Which probes share a line, and in what order — the
 *    `signature`. This is what almost every question in this corpus actually
 *    asks: did the block child split the run, did the inline-flex stay in the
 *    line, did the flex container blockify its inline child. Font metrics
 *    change where the lines are, never how many there are or what is on them.
 *
 * 2. **Absolutes that CSS fixes outright.** A block child's width is the
 *    container's content width. A sized `inline-block` is exactly its declared
 *    size. Padding is in CSS pixels. These are declared per case in `assert`.
 *
 * 3. **Differences.** A case may name a `baseline` case it differs from by one
 *    property; the delta between them — "adding 10px of inline padding moves
 *    the following text 10px right" — is font-independent even though neither
 *    number is. This is the only way to check inline box decorations exactly.
 *
 * A case that can only be judged by eye does not belong here.
 *
 * @noflow
 * @format
 */

'use strict';

const W = 320; // every container is this wide, so wrapping is comparable
const FS = 16; // and this is the font size

// Long enough to wrap at W with any reasonable font, short enough to read.
const LONG =
  'wrapping text that is long enough to need more than one line in the box';

/**
 * `text` is deliberately identical wherever two cases must produce the same
 * shaping: identical strings shape identically within one engine, which is
 * what makes a differential case a difference of one property and nothing
 * else.
 */
const SHORT = 'alpha beta';

const cases = [
  // -------------------------------------------------------------------------
  // A. A block-level child splits the inline formatting context
  //    CSS2 §9.2.1.1: when a block container has both inline- and block-level
  //    children, anonymous block boxes are generated around the inline runs.
  // -------------------------------------------------------------------------
  {
    name: 'block-splits-run',
    spec: 'CSS2 §9.2.1.1',
    why: 'Text either side of a block child lands on separate lines, with the block between them.',
    container: {display: 'block'},
    children: [
      {id: 'before', tag: 'span', children: ['before']},
      {id: 'blk', tag: 'div', style: {height: 12, backgroundColor: '#6ea8fe'}},
      {id: 'after', tag: 'span', children: ['after']},
    ],
    assert: [
      {kind: 'fillsContentWidth', id: 'blk'},
      {kind: 'below', id: 'after', of: 'blk'},
      {kind: 'below', id: 'blk', of: 'before'},
    ],
  },
  {
    name: 'block-first-then-text',
    spec: 'CSS2 §9.2.1.1',
    why: 'A leading block generates no empty anonymous block above it.',
    container: {display: 'block'},
    children: [
      {id: 'blk', tag: 'div', style: {height: 12, backgroundColor: '#6ea8fe'}},
      {id: 'after', tag: 'span', children: ['after']},
    ],
    assert: [
      {kind: 'atContentTop', id: 'blk'},
      {kind: 'fillsContentWidth', id: 'blk'},
    ],
  },
  {
    name: 'text-then-block-last',
    spec: 'CSS2 §9.2.1.1',
    why: 'A trailing block generates no empty anonymous block below it.',
    container: {display: 'block'},
    children: [
      {id: 'before', tag: 'span', children: ['before']},
      {id: 'blk', tag: 'div', style: {height: 12, backgroundColor: '#6ea8fe'}},
    ],
    assert: [
      {kind: 'atContentTop', id: 'before'},
      {kind: 'below', id: 'blk', of: 'before'},
    ],
  },
  {
    name: 'two-blocks-three-runs',
    spec: 'CSS2 §9.2.1.1',
    why: 'Every in-flow block boundary starts a new anonymous block; three runs, three lines.',
    container: {display: 'block'},
    children: [
      {id: 't1', tag: 'span', children: ['one']},
      {id: 'b1', tag: 'div', style: {height: 8, backgroundColor: '#6ea8fe'}},
      {id: 't2', tag: 'span', children: ['two']},
      {id: 'b2', tag: 'div', style: {height: 8, backgroundColor: '#f4a261'}},
      {id: 't3', tag: 'span', children: ['three']},
    ],
  },
  {
    name: 'inline-siblings-survive-the-split',
    spec: 'CSS2 §9.2.1.1',
    why: 'Inline elements adjacent to the split stay with their own side of it.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'b', children: ['bold']},
      ' plain ',
      {id: 'b', tag: 'i', children: ['ital']},
      {id: 'blk', tag: 'div', style: {height: 8, backgroundColor: '#6ea8fe'}},
      {id: 'c', tag: 'span', children: ['tail']},
    ],
    assert: [
      {kind: 'sameLine', id: 'a', of: 'b'},
      {kind: 'below', id: 'c', of: 'blk'},
    ],
  },
  {
    name: 'display-none-does-not-split',
    spec: 'css-display-3 §3.2',
    why: '`display: none` generates no box at all, so the run either side stays one run.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['left']},
      {tag: 'div', style: {display: 'none', height: 30}},
      {id: 'b', tag: 'span', children: ['right']},
    ],
    assert: [{kind: 'sameLine', id: 'a', of: 'b'}],
  },
  {
    name: 'absolute-child-does-not-split-a-block',
    spec: 'CSS2 §9.2.1.1 (in-flow only)',
    why: 'Anonymous blocks form around IN-FLOW block-level boxes; an out-of-flow child is not one.',
    container: {display: 'block', position: 'relative'},
    children: [
      {id: 'a', tag: 'span', children: ['left']},
      {
        tag: 'div',
        style: {
          position: 'absolute',
          top: 0,
          right: 0,
          width: 8,
          height: 8,
          backgroundColor: '#e76f51',
        },
      },
      {id: 'b', tag: 'span', children: ['right']},
    ],
    assert: [{kind: 'sameLine', id: 'a', of: 'b'}],
  },

  // -------------------------------------------------------------------------
  // B. Inline formatting: boxes on a line
  //    css-inline-3 §2; CSS2 §10.6.1 for the block-axis rule.
  // -------------------------------------------------------------------------
  {
    name: 'inline-padding-baseline',
    spec: 'css-inline-3 §2',
    why: 'Control for the two differential cases below: no decorations at all.',
    container: {display: 'block'},
    children: [
      'x ',
      {id: 'mid', tag: 'span', children: [SHORT]},
      {id: 'tail', tag: 'span', children: [' y']},
    ],
  },
  {
    name: 'inline-padding-inline-axis',
    spec: 'css-inline-3 §2, CSS2 §10.6.1',
    baseline: 'inline-padding-baseline',
    why: 'Inline-axis padding on an inline box advances the line: the text after it moves right by exactly the padding.',
    container: {display: 'block'},
    children: [
      'x ',
      {
        id: 'mid',
        tag: 'span',
        style: {paddingLeft: 10, paddingRight: 10},
        children: [SHORT],
      },
      {id: 'tail', tag: 'span', children: [' y']},
    ],
    diff: [
      {kind: 'widthDelta', id: 'mid', equals: 20},
      {kind: 'xDelta', id: 'tail', equals: 20},
    ],
  },
  // The three below isolate the two inline edges from each other, and scale
  // one of them, so a discrepancy can be attributed to an edge and to a
  // proportion rather than guessed at from a single number.
  {
    name: 'inline-padding-left-only',
    spec: 'css-inline-3 §2, CSS2 §10.6.1',
    baseline: 'inline-padding-baseline',
    why: 'Only the leading edge: everything from the element onwards moves right by exactly it.',
    container: {display: 'block'},
    children: [
      'x ',
      {id: 'mid', tag: 'span', style: {paddingLeft: 10}, children: [SHORT]},
      {id: 'tail', tag: 'span', children: [' y']},
    ],
    diff: [
      {kind: 'widthDelta', id: 'mid', equals: 10},
      {kind: 'xDelta', id: 'tail', equals: 10},
    ],
  },
  {
    name: 'inline-padding-right-only',
    spec: 'css-inline-3 §2, CSS2 §10.6.1',
    baseline: 'inline-padding-baseline',
    why: 'Only the trailing edge: the element keeps its position and only what follows moves.',
    container: {display: 'block'},
    children: [
      'x ',
      {id: 'mid', tag: 'span', style: {paddingRight: 10}, children: [SHORT]},
      {id: 'tail', tag: 'span', children: [' y']},
    ],
    diff: [
      {kind: 'widthDelta', id: 'mid', equals: 10},
      {kind: 'xDelta', id: 'mid', equals: 0},
      {kind: 'xDelta', id: 'tail', equals: 10},
    ],
  },
  {
    name: 'inline-padding-inline-axis-large',
    spec: 'css-inline-3 §2, CSS2 §10.6.1',
    baseline: 'inline-padding-baseline',
    why: 'The same as the 10pt case at 40pt: an engine that gets a FRACTION of the padding shows it here as a proportionally larger error.',
    container: {display: 'block'},
    children: [
      'x ',
      {
        id: 'mid',
        tag: 'span',
        style: {paddingLeft: 40, paddingRight: 40},
        children: [SHORT],
      },
      {id: 'tail', tag: 'span', children: [' y']},
    ],
    diff: [
      {kind: 'widthDelta', id: 'mid', equals: 80},
      {kind: 'xDelta', id: 'tail', equals: 80},
    ],
  },
  {
    name: 'inline-border-inline-axis',
    spec: 'css-inline-3 §2, CSS2 §10.6.1',
    baseline: 'inline-padding-baseline',
    why: 'Inline-axis borders advance the line the same way padding does.',
    container: {display: 'block'},
    children: [
      'x ',
      {
        id: 'mid',
        tag: 'span',
        style: {borderLeftWidth: 4, borderRightWidth: 4, borderColor: '#e76f51', borderStyle: 'solid'},
        children: [SHORT],
      },
      {id: 'tail', tag: 'span', children: [' y']},
    ],
    diff: [
      {kind: 'widthDelta', id: 'mid', equals: 8},
      {kind: 'xDelta', id: 'tail', equals: 8},
    ],
  },
  {
    name: 'inline-block-axis-padding-does-not-grow-the-line',
    spec: 'CSS2 §10.6.1',
    baseline: 'inline-padding-baseline',
    why: 'Block-axis padding on a non-replaced inline overflows the line box instead of growing it: the CONTAINER height does not change.',
    container: {display: 'block'},
    children: [
      'x ',
      {
        id: 'mid',
        tag: 'span',
        style: {paddingTop: 12, paddingBottom: 12},
        children: [SHORT],
      },
      {id: 'tail', tag: 'span', children: [' y']},
    ],
    diff: [{kind: 'containerHeightDelta', equals: 0}],
  },
  {
    name: 'nested-inlines',
    spec: 'css-inline-3 §2',
    why: 'A nested inline reports its own box, contained by its parent inline, both on the same line.',
    container: {display: 'block'},
    children: [
      {
        id: 'outer',
        tag: 'span',
        children: ['out ', {id: 'inner', tag: 'b', children: ['in']}, ' out'],
      },
    ],
    assert: [
      {kind: 'sameLine', id: 'outer', of: 'inner'},
      {kind: 'contains', id: 'outer', of: 'inner'},
    ],
  },
  {
    name: 'inline-wrapping-across-lines',
    spec: 'css-inline-3 §2, CSSOM-View getBoundingClientRect',
    why: 'An inline that wraps reports the UNION of its fragments — taller than one line, and wider than either fragment.',
    container: {display: 'block'},
    children: [
      // `lead` is here to be the single-line yardstick: "taller than one line"
      // is not a font-independent statement without one.
      {id: 'lead', tag: 'span', children: ['lead ']},
      {id: 'wrapped', tag: 'span', children: [LONG]},
    ],
    assert: [{kind: 'spansMultipleLines', id: 'wrapped'}],
  },

  // -------------------------------------------------------------------------
  // C. Atomic inlines: inline-block and inline-flex
  //    css-display-3 §2.2 — an atomic inline participates in the line as one
  //    opaque box rather than flowing its contents into it.
  // -------------------------------------------------------------------------
  {
    name: 'inline-block-sized-stays-in-the-line',
    spec: 'css-display-3 §2.2',
    why: 'A sized inline-block is exactly its declared size and shares the line with the text either side.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['before ']},
      {
        id: 'box',
        tag: 'div',
        style: {
          display: 'inline-block',
          width: 24,
          height: 12,
          backgroundColor: '#6ea8fe',
        },
      },
      {id: 'b', tag: 'span', children: [' after']},
    ],
    assert: [
      {kind: 'size', id: 'box', width: 24, height: 12},
      {kind: 'sameLine', id: 'a', of: 'box'},
      {kind: 'sameLine', id: 'box', of: 'b'},
    ],
  },
  {
    name: 'inline-flex-sized-stays-in-the-line',
    spec: 'css-display-3 §2.2',
    why: 'Same as inline-block: the OUTER display is inline, so the line is unaffected by the inner formatting context.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['before ']},
      {
        id: 'box',
        tag: 'div',
        style: {
          display: 'inline-flex',
          width: 24,
          height: 12,
          backgroundColor: '#2a9d8f',
        },
      },
      {id: 'b', tag: 'span', children: [' after']},
    ],
    assert: [
      {kind: 'size', id: 'box', width: 24, height: 12},
      {kind: 'sameLine', id: 'a', of: 'box'},
      {kind: 'sameLine', id: 'box', of: 'b'},
    ],
  },
  {
    name: 'inline-flex-lays-out-its-children-as-flex-items',
    spec: 'css-display-3 §2.2, css-flexbox-1 §4',
    why: 'Inner display is flex: two sized children sit side by side inside a box that is itself in the line.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['before ']},
      {
        id: 'box',
        tag: 'div',
        style: {display: 'inline-flex', height: 14},
        children: [
          {id: 'f1', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
          {id: 'f2', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#f4a261'}},
        ],
      },
      {id: 'b', tag: 'span', children: [' after']},
    ],
    assert: [
      {kind: 'sameLine', id: 'f1', of: 'f2'},
      {kind: 'contains', id: 'box', of: 'f1'},
      {kind: 'contains', id: 'box', of: 'f2'},
      {kind: 'sameLine', id: 'a', of: 'box'},
    ],
  },
  {
    name: 'inline-block-wraps-its-own-text',
    spec: 'css-display-3 §2.2',
    why: 'The inner display is flow-root: a width-constrained inline-block wraps internally rather than widening the outer line.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['before ']},
      {
        id: 'box',
        tag: 'div',
        style: {display: 'inline-block', width: 80, backgroundColor: '#eef2ff'},
        children: [LONG],
      },
    ],
    assert: [{kind: 'size', id: 'box', width: 80}],
  },
  {
    name: 'atomic-inline-between-two-runs-does-not-split-them',
    spec: 'css-display-3 §2.2',
    why: 'An atomic inline is inline-LEVEL, so unlike a block it never generates anonymous blocks around the text.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['left ']},
      {
        id: 'box',
        tag: 'div',
        style: {display: 'inline-block', width: 12, height: 12, backgroundColor: '#6ea8fe'},
      },
      {id: 'b', tag: 'span', children: [' right']},
    ],
    assert: [{kind: 'sameLine', id: 'a', of: 'b'}],
  },

  // -------------------------------------------------------------------------
  // D. Flex containers holding text
  //    css-flexbox-1 §4: contiguous text in a flex container is wrapped in an
  //    anonymous flex item, and every in-flow child is blockified.
  // -------------------------------------------------------------------------
  {
    name: 'flex-row-items-sit-side-by-side',
    spec: 'css-flexbox-1 §4, css-display-3 §2.7',
    why: 'Inline children of a flex container are blockified into flex items, so in a row they sit beside each other rather than joining one line box.',
    container: {display: 'flex', flexDirection: 'row'},
    children: [
      {id: 'a', tag: 'span', children: ['one']},
      {id: 'mid', tag: 'div', style: {width: 12, height: 12, backgroundColor: '#6ea8fe'}},
      {id: 'b', tag: 'span', children: ['two']},
    ],
    assert: [
      {kind: 'sameLine', id: 'a', of: 'b'},
      {kind: 'xOrder', ids: ['a', 'mid', 'b']},
    ],
  },
  {
    name: 'flex-column-stacks-items',
    spec: 'css-flexbox-1 §4, css-display-3 §2.7',
    why: 'The same three children in a column stack instead.',
    container: {display: 'flex', flexDirection: 'column'},
    children: [
      {id: 'a', tag: 'span', children: ['one']},
      {id: 'mid', tag: 'div', style: {width: 12, height: 12, backgroundColor: '#6ea8fe'}},
      {id: 'b', tag: 'span', children: ['two']},
    ],
    assert: [
      {kind: 'below', id: 'mid', of: 'a'},
      {kind: 'below', id: 'b', of: 'mid'},
    ],
  },

  // The four cases below are about ANONYMOUS flex items, which is text with no
  // element around it. Wrapping the text in a probe would defeat the case —
  // the wrapper would blockify into a real item and there would be no
  // anonymous one left to observe. So the text stays bare and a sized marker
  // after it does the reporting: how far down the marker sits is exactly how
  // many items the text became.
  {
    name: 'flex-anonymous-item-baseline',
    spec: 'css-flexbox-1 §4',
    why: 'Two adjacent bare strings are contiguous text, so they generate ONE anonymous flex item. The marker records where that leaves the next item.',
    container: {display: 'flex', flexDirection: 'column'},
    children: [
      'one ',
      'two',
      {id: 'marker', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
    ],
  },
  {
    name: 'flex-display-none-does-not-split-a-run',
    spec: 'css-display-3 §3.2',
    baseline: 'flex-anonymous-item-baseline',
    why: 'A `display: none` child generates no box, so the text either side is still contiguous and still one item — the marker does not move.',
    container: {display: 'flex', flexDirection: 'column'},
    children: [
      'one ',
      {tag: 'div', style: {display: 'none', width: 12, height: 12}},
      'two',
      {id: 'marker', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
    ],
    diff: [{kind: 'yDelta', id: 'marker', equals: 0}],
  },
  {
    name: 'flex-block-child-splits-a-run',
    spec: 'css-flexbox-1 §4',
    baseline: 'flex-anonymous-item-baseline',
    why: 'A real in-flow child between the strings makes them two anonymous items with an item between: the marker drops by a whole line.',
    container: {display: 'flex', flexDirection: 'column'},
    children: [
      'one ',
      {id: 'sep', tag: 'div', style: {height: 6, backgroundColor: '#f4a261'}},
      'two',
      {id: 'marker', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
    ],
    diff: [{kind: 'yDelta', id: 'marker', atLeast: 6}],
  },
  {
    name: 'flex-absolute-child-splits-a-run-sequence',
    spec: 'css-flexbox-1 §4',
    baseline: 'flex-anonymous-item-baseline',
    why: 'Unlike a block container, a flex container ends a text-run sequence at an out-of-flow child: the strings become TWO anonymous items, so the marker drops by a line even though the absolute child occupies none.',
    container: {display: 'flex', flexDirection: 'column', position: 'relative'},
    children: [
      'one ',
      {
        tag: 'div',
        style: {
          position: 'absolute',
          top: 0,
          right: 0,
          width: 8,
          height: 8,
          backgroundColor: '#e76f51',
        },
      },
      'two',
      {id: 'marker', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
    ],
    diff: [{kind: 'yDelta', id: 'marker', atLeast: 8}],
  },
  {
    name: 'flex-blockifies-an-inline-child',
    spec: 'css-display-3 §2.7',
    why: 'An `inline` child of a flex container is blockified into a flex item, so it no longer shares a line with the text beside it.',
    container: {display: 'flex', flexDirection: 'column'},
    children: [
      {id: 'a', tag: 'span', style: {display: 'inline'}, children: ['one']},
      {id: 'b', tag: 'span', style: {display: 'inline'}, children: ['two']},
    ],
    assert: [{kind: 'below', id: 'b', of: 'a'}],
  },
  {
    name: 'flex-blockifies-inline-flex-to-flex',
    spec: 'css-display-3 §2.7',
    why: '`inline-flex` blockifies to `flex` as a flex item: outer display becomes block, inner stays flex.',
    container: {display: 'flex', flexDirection: 'column'},
    children: [
      {id: 'a', tag: 'span', children: ['above']},
      {
        id: 'box',
        tag: 'div',
        style: {display: 'inline-flex', height: 14},
        children: [
          {id: 'f1', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
          {id: 'f2', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#f4a261'}},
        ],
      },
    ],
    assert: [
      {kind: 'below', id: 'box', of: 'a'},
      {kind: 'sameLine', id: 'f1', of: 'f2'},
    ],
  },

  // -------------------------------------------------------------------------
  // E. Mixed nesting
  // -------------------------------------------------------------------------
  {
    name: 'flex-inside-block-between-two-runs',
    spec: 'CSS2 §9.2.1.1 + css-flexbox-1 §4',
    why: 'A flex container is block-level, so it splits the surrounding text like any block.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['above']},
      {
        id: 'flex',
        tag: 'div',
        style: {display: 'flex', flexDirection: 'row', height: 14},
        children: [
          {id: 'f1', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#6ea8fe'}},
          {id: 'f2', tag: 'div', style: {width: 10, height: 10, backgroundColor: '#f4a261'}},
        ],
      },
      {id: 'b', tag: 'span', children: ['below']},
    ],
    assert: [
      {kind: 'fillsContentWidth', id: 'flex'},
      {kind: 'below', id: 'flex', of: 'a'},
      {kind: 'below', id: 'b', of: 'flex'},
      {kind: 'sameLine', id: 'f1', of: 'f2'},
    ],
  },
  {
    name: 'block-inside-block-with-text-either-side',
    spec: 'CSS2 §9.2.1.1',
    why: 'The nested block is a block-level child like any other and splits the run.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['above']},
      {
        id: 'outer',
        tag: 'div',
        style: {display: 'block'},
        children: [{id: 'inner', tag: 'span', children: ['nested']}],
      },
      {id: 'b', tag: 'span', children: ['below']},
    ],
    assert: [
      {kind: 'fillsContentWidth', id: 'outer'},
      {kind: 'below', id: 'outer', of: 'a'},
      {kind: 'below', id: 'b', of: 'outer'},
    ],
  },
  {
    name: 'inline-flex-inside-an-inline',
    spec: 'css-display-3 §2.2',
    why: 'An atomic inline nested inside an inline flow box stays in the same line as the text around it.',
    container: {display: 'block'},
    children: [
      {
        id: 'outer',
        tag: 'span',
        children: [
          'a ',
          {
            id: 'box',
            tag: 'div',
            style: {
              display: 'inline-flex',
              width: 14,
              height: 10,
              backgroundColor: '#2a9d8f',
            },
          },
          ' b',
        ],
      },
    ],
    assert: [
      {kind: 'sameLine', id: 'outer', of: 'box'},
      {kind: 'contains', id: 'outer', of: 'box'},
    ],
  },
  {
    name: 'three-runs-around-two-atomic-inlines',
    spec: 'css-display-3 §2.2',
    why: 'Atomic inlines never split a run; all five probes share one line while it still fits.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['a ']},
      {id: 'x', tag: 'div', style: {display: 'inline-block', width: 10, height: 10, backgroundColor: '#6ea8fe'}},
      {id: 'b', tag: 'span', children: [' b ']},
      {id: 'y', tag: 'div', style: {display: 'inline-block', width: 10, height: 10, backgroundColor: '#f4a261'}},
      {id: 'c', tag: 'span', children: [' c']},
    ],
    assert: [{kind: 'xOrder', ids: ['a', 'x', 'b', 'y', 'c']}],
  },
  {
    name: 'block-splits-a-run-that-was-already-wrapping',
    spec: 'CSS2 §9.2.1.1',
    why: 'The split applies to the run, not to the line: wrapped text before the block still ends above it.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: [LONG]},
      {id: 'blk', tag: 'div', style: {height: 8, backgroundColor: '#6ea8fe'}},
      {id: 'b', tag: 'span', children: ['tail']},
    ],
    assert: [
      {kind: 'spansMultipleLines', id: 'a'},
      {kind: 'below', id: 'blk', of: 'a'},
      {kind: 'below', id: 'b', of: 'blk'},
    ],
  },
  {
    name: 'inline-block-containing-a-block',
    spec: 'css-display-3 §2.2',
    why: 'inline-block establishes a block formatting context, so a block child inside it fills its content width.',
    container: {display: 'block'},
    children: [
      {id: 'a', tag: 'span', children: ['before ']},
      {
        id: 'box',
        tag: 'div',
        style: {display: 'inline-block', width: 60, backgroundColor: '#eef2ff'},
        children: [
          {id: 'inner', tag: 'div', style: {height: 8, backgroundColor: '#6ea8fe'}},
        ],
      },
    ],
    assert: [
      {kind: 'size', id: 'box', width: 60},
      {kind: 'size', id: 'inner', width: 60},
    ],
  },

  // -------------------------------------------------------------------------
  // F. getBoundingClientRect on things that are not views
  //    CSSOM-View §4. These are the cases where the API is easiest to get
  //    wrong: an element with no box of its own, or several boxes.
  // -------------------------------------------------------------------------
  {
    name: 'rect-of-an-inline-with-no-decorations',
    spec: 'CSSOM-View §4',
    why: 'A bare inline still has a box: non-zero size, inside its container.',
    container: {display: 'block'},
    children: ['lead ', {id: 'probe', tag: 'span', children: ['measured']}],
    assert: [
      {kind: 'nonEmpty', id: 'probe'},
      {kind: 'insideContainer', id: 'probe'},
    ],
  },
  {
    name: 'rect-of-an-empty-inline',
    spec: 'CSSOM-View §4',
    why: 'An inline with no text has a zero-width box, not a missing one — it still has a position on the line.',
    container: {display: 'block'},
    children: [
      {id: 'lead', tag: 'span', children: ['lead']},
      {id: 'probe', tag: 'span', children: []},
      {id: 'tail', tag: 'span', children: ['tail']},
    ],
    assert: [{kind: 'insideContainer', id: 'probe'}],
  },
  {
    name: 'rect-of-a-padded-inline-is-the-border-box',
    spec: 'CSSOM-View §4',
    baseline: 'rect-of-an-inline-with-no-decorations',
    why: 'getBoundingClientRect returns the BORDER box, so padding is included in both axes.',
    container: {display: 'block'},
    children: [
      'lead ',
      {id: 'probe', tag: 'span', style: {paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3}, children: ['measured']},
    ],
    diff: [
      {kind: 'widthDelta', id: 'probe', equals: 12},
      {kind: 'heightDelta', id: 'probe', equals: 6},
    ],
  },
  {
    name: 'rect-of-a-block-is-the-content-width',
    spec: 'CSSOM-View §4',
    why: 'The plainest possible check that container-relative coordinates are right.',
    container: {display: 'block'},
    children: [{id: 'probe', tag: 'div', style: {height: 10, backgroundColor: '#6ea8fe'}}],
    assert: [
      {kind: 'fillsContentWidth', id: 'probe'},
      {kind: 'atContentTop', id: 'probe'},
      {kind: 'size', id: 'probe', height: 10},
    ],
  },
  {
    name: 'rect-inside-a-padded-container',
    spec: 'CSSOM-View §4',
    why: 'Probes are reported relative to the container BORDER box, so the container padding shows up as an offset.',
    container: {display: 'block', padding: 12},
    children: [{id: 'probe', tag: 'div', style: {height: 10, backgroundColor: '#6ea8fe'}}],
    assert: [
      {kind: 'offset', id: 'probe', x: 12, y: 12},
      {kind: 'size', id: 'probe', width: W - 24, height: 10},
    ],
  },
];

module.exports = {cases, W, FS, LONG, SHORT};
