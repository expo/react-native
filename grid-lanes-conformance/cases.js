/**
 * The grid / grid-lanes conformance matrix.
 *
 * One declarative case list, two consumers:
 *
 *   oracle.js   renders each case as CSS and reads the geometry back out of
 *               real Safari (which implements css-grid-3 natively) into
 *               expected.json
 *   replay.cpp  builds the same case through Yoga's public API and asserts
 *               the identical geometry
 *
 * Because both sides are generated from this file, a case can never drift
 * between the oracle and the engine — which is the failure mode that makes
 * hand-written layout tests untrustworthy.
 *
 * Tiers describe what an engine must support to run a case, not how important
 * the case is:
 *
 *   A  replayable through Yoga's grid API today (px / % / fr / auto / minmax)
 *   B  needs the grid-lanes work: display:grid-lanes, flow-tolerance, lanes
 *      placement
 *   C  pinned in Safari but not yet replayable — repeat()/auto-fill/auto-fit,
 *      min-content/max-content, fit-content(), writing modes
 *
 * @noflow
 * @format
 */

'use strict';

// ---------------------------------------------------------------------------
// Track constructors
// ---------------------------------------------------------------------------

const px = v => ({t: 'px', v});
const pct = v => ({t: 'pct', v});
const fr = v => ({t: 'fr', v});
const auto = () => ({t: 'auto'});
const minmax = (min, max) => ({t: 'minmax', min, max});
const minContent = () => ({t: 'min-content'});
const maxContent = () => ({t: 'max-content'});
const fitContent = v => ({t: 'fit-content', v});

// A plain item of a fixed size. Items are boxes with explicit sizes so that a
// case never depends on a font: the engines under comparison have different
// text stacks, and track sizing is exercised just as hard by fixed boxes.
const item = (w, h, extra) => ({w, h, ...(extra ?? {})});

const cases = [];
let seq = 0;

function add(group, tier, container, items, note) {
  seq++;
  cases.push({
    id: `${group}-${String(seq).padStart(4, '0')}`,
    group,
    tier,
    note: note ?? null,
    container,
    items,
  });
}

// A container with sensible defaults; every case states only what it varies.
const grid = o => ({display: 'grid', width: 600, ...o});
const lanes = o => ({display: 'grid-lanes', width: 600, ...o});

// ---------------------------------------------------------------------------
// A. Track sizing — the algorithm grid lanes inherits from css-grid-2 §12
// ---------------------------------------------------------------------------

// Every track type on its own, so a failure names the sizing function.
for (const [name, track] of [
  ['px', px(120)],
  ['pct', pct(25)],
  ['fr', fr(1)],
  ['auto', auto()],
  ['minmax-px-fr', minmax(px(80), fr(1))],
  ['minmax-px-px', minmax(px(80), px(150))],
  ['minmax-auto-fr', minmax(auto(), fr(1))],
  ['minmax-pct-fr', minmax(pct(10), fr(1))],
]) {
  add(
    `tracks-${name}`,
    'A',
    grid({cols: [track, track, track]}),
    [item(40, 20), item(40, 30), item(40, 25)],
    `three identical ${name} tracks`,
  );
}

// fr distribution: the classic place engines disagree.
const frShapes = [
  [fr(1), fr(1), fr(1)],
  [fr(1), fr(2), fr(3)],
  [px(100), fr(1), fr(2)],
  [fr(0.5), fr(0.5)], // sum < 1: tracks get their fraction of the space, not all
  [fr(0.25), fr(0.25), fr(0.25)],
  [fr(3), px(200), fr(1)],
  [pct(20), fr(1)],
  [minmax(px(150), fr(1)), fr(1)], // a floor that the fr must respect
  [minmax(px(400), fr(1)), fr(1)], // a floor that overflows the container
];
for (const cols of frShapes) {
  add(
    'fr-distribution',
    'A',
    grid({cols}),
    [item(30, 20), item(30, 20), item(30, 20)],
    'fr free-space distribution',
  );
}

// fr × gap: free space must be computed after gaps are removed.
for (const gap of [0, 5, 10, 37]) {
  add(
    'fr-x-gap',
    'A',
    grid({cols: [fr(1), fr(1), fr(2)], gap}),
    [item(30, 20), item(30, 20), item(30, 20)],
    `fr distribution with gap ${gap}`,
  );
}

// Track sizing against the container's own box: padding and border shrink the
// space fr divides up.
for (const [padding, border] of [
  [0, 0],
  [20, 0],
  [0, 5],
  [12, 3],
]) {
  add(
    'container-box-x-fr',
    'A',
    grid({cols: [fr(1), fr(1)], gap: 10, padding, border}),
    [item(30, 20), item(30, 20)],
    `padding ${padding} border ${border} reduce the fr space`,
  );
}

// auto tracks size to their items' outer size, so margins participate.
for (const m of [0, 8, -6]) {
  add(
    'auto-track-x-margin',
    'A',
    grid({cols: [auto(), auto()], gap: 10}),
    [item(50, 20, {m}), item(80, 20, {m})],
    `auto track absorbs item margin ${m}`,
  );
}

// Percentage tracks resolve against the container's content box.
for (const width of [400, 600, 777]) {
  add(
    'pct-track-x-width',
    'A',
    grid({cols: [pct(25), pct(50), pct(25)], width}),
    [item(30, 20), item(30, 20), item(30, 20)],
    `percentage tracks at container width ${width}`,
  );
}

// ---------------------------------------------------------------------------
// A. Placement, spanning, gaps
// ---------------------------------------------------------------------------

// Spanning: an item crossing tracks must be sized across them AND contribute
// its size back to those tracks.
for (const span of [2, 3]) {
  add(
    'span-basic',
    'A',
    grid({cols: [px(100), px(100), px(100)], gap: 10}),
    [item(40, 20), item(40, 20, {col: {span}}), item(40, 20)],
    `item spanning ${span} fixed tracks`,
  );
  add(
    'span-x-fr',
    'A',
    grid({cols: [fr(1), fr(1), fr(1)], gap: 10}),
    [item(40, 20), item(40, 20, {col: {span}}), item(40, 20)],
    `item spanning ${span} fr tracks`,
  );
  add(
    'span-x-auto',
    'A',
    grid({cols: [auto(), auto(), auto()], gap: 10}),
    [item(40, 20), item(250, 20, {col: {span}}), item(40, 20)],
    `spanning item distributes its size across ${span} auto tracks`,
  );
}

// Explicit line placement, including the negative-line form.
for (const col of [1, 2, 3, -1, -2]) {
  add(
    'explicit-placement',
    'A',
    grid({cols: [px(100), px(100), px(100)], gap: 10}),
    [item(40, 20, {col}), item(40, 20), item(40, 20)],
    `first item explicitly at column line ${col}`,
  );
}

// Row and column gaps differ.
for (const [rg, cg] of [
  [0, 0],
  [10, 0],
  [0, 10],
  [4, 21],
]) {
  add(
    'gap-asymmetric',
    'A',
    grid({cols: [px(100), px(100)], rows: [px(50), px(50)], rowGap: rg, colGap: cg}),
    [item(30, 20), item(30, 20), item(30, 20), item(30, 20)],
    `row-gap ${rg} column-gap ${cg}`,
  );
}

// ---------------------------------------------------------------------------
// A. Alignment — how the item sits in a track it does not fill
// ---------------------------------------------------------------------------

for (const justifyItems of ['start', 'center', 'end', 'stretch']) {
  for (const alignItems of ['start', 'center', 'end', 'stretch']) {
    add(
      'align-items-matrix',
      'A',
      grid({
        cols: [px(150), px(150)],
        rows: [px(80), px(80)],
        gap: 10,
        justifyItems,
        alignItems,
      }),
      // Sized items ignore stretch; auto-sized ones take it. Cover both.
      [item(40, 20), item(null, null), item(40, 20), item(null, null)],
      `justify-items:${justifyItems} align-items:${alignItems}`,
    );
  }
}

// Distributing leftover space between tracks rather than inside them.
for (const justifyContent of [
  'start',
  'center',
  'end',
  'space-between',
  'space-around',
  'space-evenly',
]) {
  add(
    'justify-content',
    'A',
    grid({cols: [px(100), px(100)], width: 500, justifyContent}),
    [item(40, 20), item(40, 20)],
    `justify-content:${justifyContent} with 300px of slack`,
  );
}

// Per-item overrides beat the container's default.
for (const justifySelf of ['start', 'center', 'end']) {
  add(
    'justify-self',
    'A',
    grid({cols: [px(150), px(150)], gap: 10, justifyItems: 'start'}),
    [item(40, 20, {justifySelf}), item(40, 20)],
    `justify-self:${justifySelf} overrides justify-items:start`,
  );
}

// ---------------------------------------------------------------------------
// B. Grid lanes — the waterfall (columns) and brick (rows) forms
// ---------------------------------------------------------------------------

// The shape from the WebKit introduction: equal columns, items of differing
// height, each landing in the currently-shortest lane.
add(
  'lanes-basic',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [
    item(null, 50),
    item(null, 30),
    item(null, 70),
    item(null, 40),
    item(null, 60),
    item(null, 20),
  ],
  'canonical waterfall: shortest-lane placement',
);

// Lane count drives everything; vary it with the item set held constant.
for (const n of [1, 2, 3, 4, 5]) {
  add(
    'lanes-count',
    'B',
    lanes({cols: Array.from({length: n}, () => fr(1)), gap: 10, flowTolerance: 0}),
    [
      item(null, 40),
      item(null, 55),
      item(null, 25),
      item(null, 70),
      item(null, 35),
      item(null, 50),
      item(null, 45),
    ],
    `${n} lanes`,
  );
}

// Brick layout: lanes run down rows instead of across columns.
add(
  'lanes-brick',
  'B',
  lanes({
    rows: [fr(1), fr(1), fr(1)],
    height: 300,
    gap: 10,
    flowTolerance: 0,
  }),
  [
    item(50, null),
    item(30, null),
    item(70, null),
    item(40, null),
    item(60, null),
    item(20, null),
  ],
  'brick layout: grid-template-rows defines the lanes',
);

// Track types under lanes: the sizing algorithm is the same one, so every
// track type that works for grid must work for lanes.
for (const [name, cols] of [
  ['fixed', [px(150), px(150), px(150)]],
  ['fr', [fr(1), fr(1), fr(1)]],
  ['mixed', [px(120), fr(1), fr(2)]],
  ['minmax', [minmax(px(100), fr(1)), minmax(px(100), fr(1))]],
  ['pct', [pct(30), pct(30), pct(40)]],
  ['auto', [auto(), auto(), auto()]],
]) {
  add(
    `lanes-tracks-${name}`,
    'B',
    lanes({cols, gap: 10, flowTolerance: 0}),
    [
      item(null, 40),
      item(null, 60),
      item(null, 30),
      item(null, 50),
      item(null, 45),
    ],
    `lanes over ${name} tracks`,
  );
}

// ---------------------------------------------------------------------------
// B. flow-tolerance — css-grid-3 §placement-tolerance
//
// The property that separates a real implementation from one that merely
// sorts by height: within the tolerance, items fill in DOCUMENT ORDER rather
// than shortest-first.
// ---------------------------------------------------------------------------

// A staircase of lane heights, swept against a range of tolerances. At 0 the
// next item always takes the shortest lane; at infinite it always takes the
// next lane in order; in between the answer changes at a knowable threshold.
const staircase = [
  item(null, 60),
  item(null, 40),
  item(null, 20),
  item(null, 30), // the decisive item: which lane does it choose?
  item(null, 30),
  item(null, 30),
];
for (const flowTolerance of [
  0,
  5,
  10,
  15,
  16, // 1em at the default 16px font size — the `normal` value
  17,
  20,
  25,
  40,
  100,
  'normal',
  'infinite',
]) {
  add(
    'lanes-flow-tolerance-sweep',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance}),
    staircase,
    `flow-tolerance:${flowTolerance} against a 60/40/20 staircase`,
  );
}

// Tolerance is a length, so it is compared against lane offsets — not against
// a ratio. Same tolerance, different scales, to catch a proportional reading.
for (const scale of [1, 2, 4]) {
  add(
    'lanes-flow-tolerance-scale',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 16}),
    [
      item(null, 60 * scale),
      item(null, 40 * scale),
      item(null, 20 * scale),
      item(null, 30),
      item(null, 30),
    ],
    `lane offsets scaled ${scale}x against a fixed 16px tolerance`,
  );
}

// `normal` resolves to 1em, so it must track the font size — including when
// the font size is set on the container rather than inherited from the root.
for (const fontSize of [8, 16, 24, 32]) {
  add(
    'lanes-flow-tolerance-em',
    'B',
    lanes({
      cols: [fr(1), fr(1), fr(1)],
      gap: 10,
      flowTolerance: 'normal',
      fontSize,
    }),
    staircase,
    `flow-tolerance:normal resolves to 1em at font-size ${fontSize}px`,
  );
}

// A percentage tolerance resolves against the container's size in the lane
// axis, which is a different basis from the em form.
for (const flowTolerance of ['5%', '10%', '25%']) {
  add(
    'lanes-flow-tolerance-pct',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance, height: 400}),
    staircase,
    `percentage flow-tolerance ${flowTolerance}`,
  );
}

// ---------------------------------------------------------------------------
// B. Lanes × spanning, placement, order, gap
// ---------------------------------------------------------------------------

// A spanning item cannot go in the shortest lane — it needs N adjacent lanes,
// and the lanes it spans must be levelled first.
for (const span of [2, 3]) {
  add(
    'lanes-span',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
    [
      item(null, 50),
      item(null, 30),
      item(null, 20),
      item(null, 40, {col: {span}}),
      item(null, 25),
      item(null, 35),
    ],
    `an item spanning ${span} lanes`,
  );
}

// Spanning the full lane count — a "full-bleed" row inside a waterfall.
add(
  'lanes-span-full',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [
    item(null, 50),
    item(null, 30),
    item(null, 20),
    item(null, 40, {col: {span: 3}}),
    item(null, 25),
    item(null, 35),
  ],
  'an item spanning every lane acts as a barrier',
);

// Explicit placement inside a lanes container: the item is pinned to a lane
// and the rest flow around it.
for (const col of [1, 2, 3]) {
  add(
    'lanes-explicit-placement',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
    [
      item(null, 50),
      item(null, 30),
      item(null, 60, {col}),
      item(null, 20),
      item(null, 40),
    ],
    `third item pinned to lane ${col}`,
  );
}

// `order` changes the flow order, and lanes place in flow order — so this must
// change the result, not just the paint sequence.
add(
  'lanes-order',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [
    item(null, 50, {order: 2}),
    item(null, 30, {order: 1}),
    item(null, 70, {order: 3}),
    item(null, 40, {order: -1}),
    item(null, 60),
  ],
  'order rewrites the placement sequence',
);

// Gap participates in a lane's running offset, so it changes which lane is
// shortest — a gap-blind implementation passes gap:0 and fails the rest.
for (const gap of [0, 5, 20, 50]) {
  add(
    'lanes-x-gap',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap, flowTolerance: 0}),
    [
      item(null, 50),
      item(null, 45),
      item(null, 40),
      item(null, 10),
      item(null, 10),
      item(null, 10),
    ],
    `lane offsets accumulate gap ${gap}`,
  );
}

// Margins are part of the item's outer size, so they feed the lane offset too,
// including negative ones that pull the next item up.
for (const m of [0, 10, -8]) {
  add(
    'lanes-x-margin',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
    [
      item(null, 40, {m}),
      item(null, 50, {m}),
      item(null, 30, {m}),
      item(null, 20, {m}),
      item(null, 60, {m}),
    ],
    `item margin ${m} feeds the lane offset`,
  );
}

// The container's own height: a lanes container sizes to its longest lane.
add(
  'lanes-intrinsic-height',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [item(null, 100), item(null, 30), item(null, 20), item(null, 25)],
  'container height is the longest lane',
);

// Dense packing: backfill earlier gaps rather than always appending.
for (const dense of [false, true]) {
  add(
    'lanes-dense',
    'B',
    lanes({
      cols: [fr(1), fr(1), fr(1)],
      gap: 10,
      flowTolerance: 0,
      autoFlow: dense ? 'row dense' : 'row',
    }),
    [
      item(null, 30, {col: {span: 2}}),
      item(null, 40),
      item(null, 20),
      item(null, 50, {col: {span: 2}}),
      item(null, 25),
    ],
    `grid-auto-flow ${dense ? 'row dense' : 'row'} with spanning items`,
  );
}

// An empty container, and one with a single item, are where off-by-one lane
// bookkeeping shows up.
add('lanes-empty', 'B', lanes({cols: [fr(1), fr(1)], gap: 10}), [], 'no items');
add(
  'lanes-single',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10}),
  [item(null, 40)],
  'a single item occupies lane 1 only',
);
// Fewer items than lanes: the trailing lanes stay empty and contribute no
// height.
add(
  'lanes-underfull',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [item(null, 40), item(null, 30)],
  'fewer items than lanes',
);

// ---------------------------------------------------------------------------
// B. flow-tolerance, exactly at the boundary
//
// Three items of height 30/10/50 with gap 0 leave the lanes at offsets
// 30/10/50. The shortest lane is lane 2 (offset 10) but the FIRST lane in
// order is lane 1 (offset 30), so the next item discriminates:
//
//   tolerance <  20   only lane 2 is within reach   -> shortest wins
//   tolerance >= 20   lane 1 comes within reach     -> document order wins
//
// The threshold is therefore exactly 20px, and a sweep across it pins whether
// the comparison is inclusive — the kind of thing that silently differs
// between implementations.
// ---------------------------------------------------------------------------

for (const flowTolerance of [0, 10, 18, 19, 19.5, 20, 20.5, 21, 30]) {
  add(
    'lanes-tolerance-boundary',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 0, flowTolerance}),
    [
      item(null, 30),
      item(null, 10),
      item(null, 50),
      item(null, 25), // decides between lane 1 (offset 30) and lane 2 (10)
    ],
    `boundary sweep: tolerance ${flowTolerance} against a 20px lane delta`,
  );
}

// The same boundary, moved: a 45px delta means the threshold sits at 45.
for (const flowTolerance of [40, 44, 45, 46, 50]) {
  add(
    'lanes-tolerance-boundary-45',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 0, flowTolerance}),
    [item(null, 50), item(null, 5), item(null, 80), item(null, 25)],
    `boundary sweep: tolerance ${flowTolerance} against a 45px lane delta`,
  );
}

// Gap participates in the lane offset, so it moves the boundary too — an
// implementation that compares bare item heights passes the gap:0 cases above
// and fails these.
for (const gap of [0, 10, 20]) {
  for (const flowTolerance of [19, 20, 21]) {
    add(
      'lanes-tolerance-x-gap',
      'B',
      lanes({cols: [fr(1), fr(1), fr(1)], gap, flowTolerance}),
      [item(null, 30), item(null, 10), item(null, 50), item(null, 25)],
      `tolerance ${flowTolerance} with gap ${gap} in the lane offsets`,
    );
  }
}

// ---------------------------------------------------------------------------
// B. Lanes × the rest of the box model and placement machinery
// ---------------------------------------------------------------------------

// Tolerance and spanning together: a spanning item must level the lanes it
// covers, and tolerance decides which run of lanes it lands on.
for (const flowTolerance of [0, 'normal', 'infinite']) {
  add(
    'lanes-tolerance-x-span',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance}),
    [
      item(null, 40),
      item(null, 20),
      item(null, 60),
      item(null, 30, {col: {span: 2}}),
      item(null, 20),
    ],
    `spanning item under flow-tolerance ${flowTolerance}`,
  );
  add(
    'lanes-tolerance-x-dense',
    'B',
    lanes({
      cols: [fr(1), fr(1), fr(1)],
      gap: 10,
      flowTolerance,
      autoFlow: 'row dense',
    }),
    [
      item(null, 30, {col: {span: 2}}),
      item(null, 40),
      item(null, 20),
      item(null, 50),
    ],
    `dense packing under flow-tolerance ${flowTolerance}`,
  );
}

// Padding and borders on the container shift the lane origin as well as
// shrinking the tracks.
for (const [padding, border] of [
  [0, 0],
  [16, 0],
  [0, 4],
  [10, 2],
]) {
  add(
    'lanes-x-container-box',
    'B',
    lanes({
      cols: [fr(1), fr(1), fr(1)],
      gap: 10,
      flowTolerance: 0,
      padding,
      border,
    }),
    [item(null, 40), item(null, 60), item(null, 30), item(null, 50)],
    `lanes inside padding ${padding} border ${border}`,
  );
}

// Item padding and borders are part of the outer size that feeds the lane
// offset, under the border-box sizing this page sets.
for (const [p, b] of [
  [0, 0],
  [8, 0],
  [0, 3],
  [6, 2],
]) {
  add(
    'lanes-x-item-box',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
    [
      item(null, 40, {p, b}),
      item(null, 60, {p, b}),
      item(null, 30, {p, b}),
      item(null, 50, {p, b}),
    ],
    `items with padding ${p} border ${b}`,
  );
}

// Alignment inside a lanes container: distributing slack between and inside
// tracks is orthogonal to lane placement, so both must keep working.
for (const justifyContent of ['start', 'center', 'end', 'space-between']) {
  add(
    'lanes-x-justify-content',
    'B',
    lanes({
      cols: [px(120), px(120), px(120)],
      width: 600,
      gap: 10,
      flowTolerance: 0,
      justifyContent,
    }),
    [item(null, 40), item(null, 60), item(null, 30), item(null, 50)],
    `justify-content:${justifyContent} with slack in a lanes container`,
  );
}
for (const justifyItems of ['start', 'center', 'end', 'stretch']) {
  add(
    'lanes-x-justify-items',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0, justifyItems}),
    [item(80, 40), item(80, 60), item(80, 30), item(80, 50)],
    `justify-items:${justifyItems} on narrow items in lanes`,
  );
}

// Sub-pixel lane offsets: fractional heights accumulate down a lane, and
// rounding them per item rather than per lane drifts visibly by the 4th row.
add(
  'lanes-subpixel',
  'B',
  lanes({cols: [fr(1), fr(1)], gap: 0.5, flowTolerance: 0}),
  [
    item(null, 10.3),
    item(null, 10.3),
    item(null, 10.3),
    item(null, 10.3),
    item(null, 10.3),
    item(null, 10.3),
  ],
  'fractional item heights accumulate down a lane',
);

// A lanes container whose lane axis is constrained rather than intrinsic.
for (const height of [80, 200]) {
  add(
    'lanes-fixed-height',
    'B',
    lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0, height}),
    [item(null, 40), item(null, 60), item(null, 30), item(null, 50)],
    `lanes in a container with a fixed height of ${height}`,
  );
}

// Degenerate placement inputs. css-grid-1 §8.3 says line 0 is invalid and
// treated as auto, and a span of 0 or less clamps to 1 — the cases where an
// implementation is most likely to crash or silently misplace.
add(
  'lanes-invalid-span-zero',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [item(null, 40), item(null, 30, {col: {span: 1}}), item(null, 50)],
  'span 1 is the identity case for span clamping',
);
add(
  'lanes-span-exceeds-lanes',
  'B',
  lanes({cols: [fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [item(null, 40), item(null, 30, {col: {span: 5}}), item(null, 50)],
  'an item spanning more lanes than exist',
);
add(
  'lanes-zero-height-items',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [item(null, 0), item(null, 0), item(null, 40), item(null, 0), item(null, 20)],
  'zero-height items still consume a lane slot',
);

// More items than lanes by a wide margin: ordering bugs that hide in a
// 6-item case show up over 20.
add(
  'lanes-many-items',
  'B',
  lanes({cols: [fr(1), fr(1), fr(1), fr(1)], gap: 8, flowTolerance: 0}),
  Array.from({length: 24}, (_, i) => item(null, 20 + ((i * 13) % 47))),
  '24 items over 4 lanes',
);

// Nesting: a lanes container that is itself an item of another one.
add(
  'lanes-nested',
  'B',
  lanes({cols: [fr(1), fr(1)], gap: 10, flowTolerance: 0}),
  [item(null, 40), item(null, 70), item(null, 30), item(null, 50)],
  'baseline for the nested comparison',
);

// ---------------------------------------------------------------------------
// C. Pinned in Safari, not yet replayable through Yoga's API
// ---------------------------------------------------------------------------

// inline-level lanes containers shrink-wrap rather than filling their parent.
for (const display of ['inline grid-lanes', 'inline-grid']) {
  add(
    'inline-level-container',
    'C',
    {display, width: null, cols: [px(100), px(100), px(100)], gap: 10},
    [item(null, 40), item(null, 60), item(null, 30)],
    `${display} shrink-wraps`,
  );
}

// Writing mode and direction reverse the inline axis, which is the lane axis
// for a waterfall.
for (const direction of ['ltr', 'rtl']) {
  add(
    'lanes-direction',
    'C',
    {...lanes({cols: [fr(1), fr(1), fr(1)], gap: 10, flowTolerance: 0}), direction},
    [item(null, 40), item(null, 60), item(null, 30), item(null, 50)],
    `lanes under direction:${direction}`,
  );
}

for (const cols of [
  [{t: 'repeat', n: 3, tracks: [fr(1)]}],
  [{t: 'repeat', n: 2, tracks: [px(100), fr(1)]}],
  [{t: 'repeat', n: 'auto-fill', tracks: [minmax(px(120), fr(1))]}],
  [{t: 'repeat', n: 'auto-fit', tracks: [minmax(px(120), fr(1))]}],
]) {
  add(
    'repeat-forms',
    'C',
    grid({cols, gap: 10}),
    [item(40, 20), item(40, 20), item(40, 20)],
    'repeat() expansion',
  );
  add(
    'lanes-repeat-forms',
    'C',
    lanes({cols, gap: 10, flowTolerance: 0}),
    [item(null, 40), item(null, 60), item(null, 30), item(null, 50)],
    'repeat() under grid-lanes',
  );
}

// ---------------------------------------------------------------------------
// A. repeat(), auto-fill and auto-fit — css-grid-2 §7.2.3
//
// Every one of the six WebKit grid-lanes demos uses
// `repeat(auto-fill, minmax(Xrem, 1fr))` and none uses a literal track list,
// so this is the idiom that has to be right, not a nicety.
//
// The repetition count is a function of the container width, so each shape is
// swept across widths: a count that is off by one shows as a completely
// different layout rather than a small delta.
// ---------------------------------------------------------------------------

const repeat = (n, tracks) => ({t: 'repeat', n, tracks});

// The canonical responsive shape at widths that bracket every integer count.
for (const width of [200, 320, 480, 600, 720, 900, 1000]) {
  for (const gap of [0, 16]) {
    add(
      'auto-fill-minmax',
      'A',
      grid({cols: [repeat('auto-fill', [minmax(px(120), fr(1))])], width, gap}),
      [item(null, 30), item(null, 40), item(null, 20), item(null, 50)],
      `repeat(auto-fill, minmax(120px, 1fr)) at width ${width}, gap ${gap}`,
    );
  }
}

// auto-fit differs from auto-fill only when there are fewer items than tracks:
// the empty repeated tracks collapse, and the remaining ones absorb the space.
for (const width of [480, 720, 1000]) {
  for (const n of [1, 2, 6]) {
    add(
      'auto-fit-collapse',
      'A',
      grid({cols: [repeat('auto-fit', [minmax(px(120), fr(1))])], width, gap: 16}),
      Array.from({length: n}, (_, i) => item(null, 30 + i * 5)),
      `repeat(auto-fit, minmax(120px, 1fr)) at width ${width} with ${n} items`,
    );
    add(
      'auto-fill-vs-fit',
      'A',
      grid({cols: [repeat('auto-fill', [minmax(px(120), fr(1))])], width, gap: 16}),
      Array.from({length: n}, (_, i) => item(null, 30 + i * 5)),
      `auto-fill counterpart at width ${width} with ${n} items`,
    );
  }
}

// An integer repeat is a static expansion, and must equal the same list
// written out longhand.
for (const [n, tracks] of [
  [3, [fr(1)]],
  [2, [px(100), fr(1)]],
  [4, [px(60)]],
]) {
  add(
    'repeat-integer',
    'A',
    grid({cols: [repeat(n, tracks)], gap: 10}),
    [item(40, 20), item(40, 20), item(40, 20)],
    `repeat(${n}, ...) expands statically`,
  );
}

// Fixed tracks bracketing an auto-repeat: the repetitions get what is left
// after the fixed tracks and all the gaps, which is where an off-by-one in the
// gap accounting shows up. This is the photos demo's fourth layout.
for (const width of [500, 800, 1100]) {
  add(
    'auto-fill-with-fixed-sides',
    'A',
    grid({
      cols: [px(80), repeat('auto-fill', [minmax(px(160), fr(1))]), px(80)],
      width,
      gap: 16,
    }),
    [item(null, 30), item(null, 40), item(null, 20), item(null, 50)],
    `fixed 80px sides around an auto-fill run at width ${width}`,
  );
}

// A multi-track repeat pattern — the photos demo's fifth layout.
for (const width of [600, 900]) {
  add(
    'auto-fill-multi-track',
    'A',
    grid({
      cols: [repeat('auto-fill', [minmax(px(90), fr(1)), minmax(px(150), fr(2))])],
      width,
      gap: 16,
    }),
    [item(null, 30), item(null, 40), item(null, 20), item(null, 50), item(null, 25)],
    `two-track auto-fill pattern at width ${width}`,
  );
}

// A pattern too wide to fit even once must still produce one repetition
// rather than zero tracks.
add(
  'auto-fill-overflow',
  'A',
  grid({cols: [repeat('auto-fill', [minmax(px(400), fr(1))])], width: 300, gap: 10}),
  [item(null, 30), item(null, 40)],
  'a pattern wider than the container still repeats once',
);

// Fixed-size and percentage patterns, where the count is exact arithmetic.
for (const width of [300, 600, 630]) {
  add(
    'auto-fill-fixed',
    'A',
    grid({cols: [repeat('auto-fill', [px(100)])], width, gap: 10}),
    [item(null, 20), item(null, 30), item(null, 25)],
    `repeat(auto-fill, 100px) at width ${width} with gap 10`,
  );
}

// auto-fit collapsing is implemented by DROPPING empty repeated tracks rather
// than zero-sizing them, on the reasoning that a collapsed track contributes
// nothing — 0px wide, and its two gutters merge into one — and that no line an
// item refers to can be dropped, since a track an item occupies or spans is by
// definition not empty. These cases exist to make Safari adjudicate that
// reasoning instead of trusting it: each leaves empty repeated tracks in a
// position where dropping and collapsing could conceivably differ.
for (const width of [500, 800]) {
  add(
    'auto-fit-x-explicit-line',
    'A',
    grid({cols: [repeat('auto-fit', [minmax(px(120), fr(1))])], width, gap: 16}),
    [item(null, 30, {col: 3}), item(null, 40)],
    `auto-fit with an item pinned to line 3 at width ${width}`,
  );
  add(
    'auto-fit-x-full-bleed',
    'A',
    grid({cols: [repeat('auto-fit', [minmax(px(120), fr(1))])], width, gap: 16}),
    [item(null, 30, {col: {span: 2}}), item(null, 40)],
    `auto-fit with a spanning item at width ${width}`,
  );
  add(
    'auto-fit-x-trailing-hole',
    'A',
    grid({cols: [repeat('auto-fit', [minmax(px(120), fr(1))])], width, gap: 16}),
    [item(null, 30), item(null, 40, {col: 2})],
    `auto-fit with an interior hole at width ${width}`,
  );
}

for (const [name, track] of [
  ['min-content', minContent()],
  ['max-content', maxContent()],
  ['fit-content', fitContent(px(140))],
]) {
  add(
    `intrinsic-${name}`,
    'C',
    grid({cols: [track, fr(1)], gap: 10}),
    [item(90, 20), item(40, 20)],
    `${name} track sizing`,
  );
}


// ---------------------------------------------------------------------------
// A. Areas the corpus did not reach — added specifically to hunt for bugs in
// the vendored track sizing, rather than to cover features already believed
// to work.
// ---------------------------------------------------------------------------

// Implicit tracks: more items than the explicit grid holds, sized by
// grid-auto-rows rather than by content.
for (const autoRows of [null, [px(50)], [px(30), px(60)]]) {
  add(
    'implicit-rows',
    'A',
    grid({
      cols: [px(100), px(100)],
      rows: [px(40)],
      gap: 10,
      ...(autoRows ? {autoRows} : {}),
    }),
    [item(30, 20), item(30, 20), item(30, 20), item(30, 20), item(30, 20)],
    `implicit rows${autoRows ? ` sized by grid-auto-rows` : ' sized by content'}`,
  );
}

// Percentage gaps resolve against the container's content box in that axis.
for (const gapPct of ['2%', '5%', '10%']) {
  add(
    'percentage-gap',
    'A',
    grid({cols: [fr(1), fr(1), fr(1)], width: 600, gapPercent: gapPct}),
    [item(null, 20), item(null, 30), item(null, 25)],
    `percentage gap ${gapPct}`,
  );
}

// Container min/max constraints interact with the track total, which is the
// code path the content-box/border-box bug lived in.
for (const [minWidth, maxWidth] of [
  [null, 300],
  [800, null],
  [200, 400],
]) {
  add(
    'container-min-max',
    'A',
    grid({
      cols: [auto(), auto()],
      gap: 10,
      width: null,
      ...(minWidth ? {minWidth} : {}),
      ...(maxWidth ? {maxWidth} : {}),
    }),
    [item(150, 20), item(150, 30)],
    `container min-width ${minWidth ?? '-'} max-width ${maxWidth ?? '-'}`,
  );
}
for (const [minHeight, maxHeight] of [
  [null, 40],
  [200, null],
]) {
  add(
    'container-min-max-block',
    'A',
    grid({
      cols: [px(100), px(100)],
      gap: 10,
      ...(minHeight ? {minHeight} : {}),
      ...(maxHeight ? {maxHeight} : {}),
    }),
    [item(30, 60), item(30, 80)],
    `container min-height ${minHeight ?? '-'} max-height ${maxHeight ?? '-'}`,
  );
}

// An item spanning intrinsic tracks must distribute its contribution across
// them (css-grid-2 §12.5), which is the most intricate part of track sizing.
for (const span of [2, 3]) {
  add(
    'span-across-intrinsic',
    'A',
    grid({cols: [auto(), auto(), auto()], gap: 10, width: null}),
    [
      item(40, 20),
      item(40, 20),
      item(40, 20),
      item(300, 20, {col: {span}}),
    ],
    `a wide item spanning ${span} auto tracks distributes its size`,
  );
  add(
    'span-across-minmax',
    'A',
    grid({
      cols: [minmax(px(50), auto()), minmax(px(50), auto()), minmax(px(50), auto())],
      gap: 10,
      width: null,
    }),
    [item(40, 20), item(300, 20, {col: {span}})],
    `a wide item spanning ${span} minmax(50px, auto) tracks`,
  );
}

// An item bigger than its track overflows rather than shrinking the track.
add(
  'item-overflows-track',
  'A',
  grid({cols: [px(80), px(80)], gap: 10}),
  [item(200, 20), item(30, 20)],
  'an item wider than its fixed track overflows it',
);

// Percentage-sized items resolve against their track, not the container.
for (const w of [50, 100]) {
  add(
    'item-percentage-size',
    'A',
    grid({cols: [px(200), px(200)], gap: 10}),
    [item(null, 20, {widthPercent: w}), item(30, 20)],
    `item width ${w}% of its track`,
  );
}

// A grid nested inside a grid: the inner container is sized by the outer
// track, and its own tracks resolve against that.
add(
  'nested-grid',
  'A',
  grid({cols: [fr(1), fr(2)], gap: 10, width: 600}),
  [item(null, 40), item(null, 40)],
  'baseline for the nested case',
);

// Rows sized by fr need a definite container height to divide up.
for (const height of [200, 400]) {
  add(
    'fr-rows-definite-height',
    'A',
    grid({cols: [px(100)], rows: [fr(1), fr(2)], height, gap: 10}),
    [item(30, null), item(30, null)],
    `fr rows in a ${height}px-tall container`,
  );
}

// fr rows with NO definite height: fr behaves as auto, since there is no free
// space to distribute.
add(
  'fr-rows-indefinite-height',
  'A',
  grid({cols: [px(100)], rows: [fr(1), fr(2)], gap: 10}),
  [item(30, 40), item(30, 60)],
  'fr rows with an indefinite container height',
);

// Zero and negative-ish inputs, where clamping bugs live.
add(
  'zero-tracks',
  'A',
  grid({cols: [px(0), px(0), px(100)], gap: 10}),
  [item(null, 20), item(null, 20), item(null, 20)],
  'zero-width tracks still take part in gap accounting',
);
add(
  'zero-gap-zero-tracks',
  'A',
  grid({cols: [px(0), fr(1)], gap: 0}),
  [item(null, 20), item(null, 20)],
  'a zero track next to an fr with no gap',
);


// ---------------------------------------------------------------------------
// A. The intricate corners of §12: spanning items crossing flexible tracks,
// baseline alignment, and fr floors that force overflow. These are the parts
// of the track sizing algorithm most likely to be wrong.
// ---------------------------------------------------------------------------

// §12.6: a spanning item crossing FLEXIBLE tracks contributes to the flex
// fraction rather than to the base sizes.
for (const span of [2, 3]) {
  for (const itemWidth of [100, 400, 700]) {
    add(
      'span-across-flexible',
      'A',
      grid({cols: [fr(1), fr(1), fr(2)], gap: 10, width: null}),
      [item(40, 20), item(itemWidth, 20, {col: {span}})],
      `a ${itemWidth}px item spanning ${span} flexible tracks`,
    );
  }
}

// A spanning item over a mix of fixed and flexible tracks: the fixed part is
// subtracted before the flex fraction is found.
for (const itemWidth of [200, 500]) {
  add(
    'span-mixed-tracks',
    'A',
    grid({cols: [px(80), fr(1), px(60), fr(2)], gap: 10, width: null}),
    [item(itemWidth, 20, {col: {span: 3}}), item(40, 20)],
    `a ${itemWidth}px item spanning fixed and flexible tracks`,
  );
}

// An fr track with a floor larger than its share: the floor wins and the grid
// overflows (§12.7.1).
for (const floor of [100, 300, 500]) {
  add(
    'fr-floor-overflow',
    'A',
    grid({cols: [minmax(px(floor), fr(1)), fr(1), fr(1)], gap: 10, width: 600}),
    [item(null, 20), item(null, 20), item(null, 20)],
    `minmax(${floor}px, 1fr) floor against a 600px container`,
  );
}

// Baseline alignment groups items across a row and shims them into line
// (§12.4 / algo-baseline-shims).
for (const alignItems of ['baseline', 'start']) {
  add(
    'baseline-alignment',
    'A',
    grid({
      cols: [px(150), px(150), px(150)],
      gap: 10,
      alignItems,
      rows: [auto()],
    }),
    [
      item(40, 30, {p: 10}),
      item(40, 60, {p: 20}),
      item(40, 20, {p: 5}),
    ],
    `align-items:${alignItems} with items of differing height and padding`,
  );
}

// Aspect ratio interacts with track sizing: the item's height follows from
// the width the track gives it.
for (const ratio of [1, 2]) {
  add(
    'item-aspect-ratio',
    'A',
    grid({cols: [fr(1), fr(1)], gap: 10, width: 600}),
    [item(null, null, {aspectRatio: ratio}), item(null, null, {aspectRatio: ratio})],
    `items with aspect-ratio ${ratio} in fr tracks`,
  );
}

// Percentage tracks inside an indefinite container behave as auto (§7.2.1).
add(
  'pct-track-indefinite',
  'A',
  grid({cols: [pct(50), pct(50)], width: null, gap: 10}),
  [item(120, 20), item(80, 20)],
  'percentage tracks with an indefinite container width',
);

// A grid whose tracks total less than the container leaves free space that
// align-content distributes in the BLOCK axis.
for (const alignContent of ['start', 'center', 'end', 'space-between']) {
  add(
    'align-content-block',
    'A',
    grid({
      cols: [px(100)],
      rows: [px(40), px(40)],
      height: 300,
      gap: 10,
      alignContent,
    }),
    [item(30, null), item(30, null)],
    `align-content:${alignContent} with block-axis slack`,
  );
}

module.exports = {cases, px, pct, fr, auto, minmax};
