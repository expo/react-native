/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * The renderer's style engine: an element hands it its class, attributes and
 * styles, and the props it lays out and draws with come from the engine's
 * pass over the committed tree (see ReactCommon/react/renderer/cssengine).
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {ScrollView} from 'react-native';

import '@react-native/expo-intrinsics-poc';

type CSSEngine = {
  flush: () => void,
  stats: () => {[string]: number},
  resetStats: () => void,
  addStyleSheet: (text: string) => number,
  removeStyleSheet: (id: number) => void,
  registerStyle: (entries: unknown) => number,
  registerTokens: (entries: unknown) => void,
  setEnvironment: (environment: {...}) => void,
  computedStyle: (node: unknown) => ?{[string]: unknown},
  matches: (node: unknown, selectors: string) => boolean,
  hints: (
    tag: string,
    className: string,
    attributes: ?{...},
    styleId: number,
    inlineStyle: unknown,
  ) => number,
};

function engine(): CSSEngine {
  // $FlowExpectedError[prop-missing] installed by the renderer
  const binding: ?CSSEngine = globalThis.__cssEngine;
  if (binding == null) {
    throw new Error('The renderer installed no __cssEngine binding.');
  }
  return binding;
}

function rect(ref: {current: HostInstance | null}): string {
  const r = ref.current?.getBoundingClientRect();
  if (r == null) {
    throw new Error('The element did not render.');
  }
  return `x=${r.x} y=${r.y} w=${r.width} h=${r.height}`;
}

test('a class rule sizes an element', () => {
  engine().addStyleSheet('.sized { width: 120px; height: 40px; }');
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic tag with engine inputs
      <div ref={ref} cssEngine={true} cssClass="sized" />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=120 h=40');
});

test('a descendant selector reads the ancestor chain', () => {
  engine().addStyleSheet(
    '.outer .inner { height: 30px; } .inner { width: 50px; height: 10px; }',
  );
  const inside = createRef<HostInstance>();
  const outside = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true}>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="outer">
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={inside} cssEngine={true} cssClass="inner" />
        </div>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={outside} cssEngine={true} cssClass="inner" />
      </div>,
    );
  });
  expect(rect(inside)).toBe('x=0 y=0 w=50 h=30');
  expect(rect(outside)).toBe('x=0 y=30 w=50 h=10');
});

test('custom properties inherit and var() resolves against them', () => {
  engine().addStyleSheet(
    '.theme { --gap: 12px; } .padded { padding: var(--gap); width: 100px; }',
  );
  const ref = createRef<HostInstance>();
  const child = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="theme">
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={ref} cssEngine={true} cssClass="padded">
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={child} cssEngine={true} cssClass="sized" />
        </div>
      </div>,
    );
  });
  expect(rect(child)).toBe('x=12 y=12 w=120 h=40');
  expect(rect(ref)).toBe('x=0 y=0 w=100 h=64');
});

test('a registered StyleX style sits under a later layer and over an earlier one', () => {
  engine().addStyleSheet(
    '@layer low, astryx-base, high; @layer low { .layered { height: 5px; width: 5px; } } @layer high { .layered { width: 70px; } }',
  );
  const styleId = engine().registerStyle([
    ['height', 22],
    ['width', '33px'],
  ]);
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssClass="layered" cssStyle={styleId} />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=70 h=22');
});

test('a StyleX conditional value follows the interaction state', () => {
  const styleId = engine().registerStyle([
    ['width', 10],
    [
      'height',
      {
        c: [
          ['default', '10px'],
          [':active', '40px'],
        ],
      },
    ],
  ]);
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssStyle={styleId} cssStates={0} />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=10 h=10');
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssStyle={styleId} cssStates={2} />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=10 h=40');
});

// The heights a box with the style takes in each interaction state, by name
function heightsByState(
  entries: unknown,
  states: {[string]: number},
): {[string]: string} {
  const styleId = engine().registerStyle(entries);
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  const heights: {[string]: string} = {};
  for (const name of Object.keys(states)) {
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[prop-missing]
        <div
          ref={ref}
          cssEngine={true}
          cssStyle={styleId}
          cssStates={states[name]}
        />,
      );
    });
    heights[name] = String(ref.current?.getBoundingClientRect().height);
  }
  return heights;
}

const HOVER = 1;
const ACTIVE = 2;

test('a StyleX block declares its properties under its condition', () => {
  expect(
    heightsByState(
      [
        ['width', 10],
        ['height', 10],
        [':active', {c: [['height', '40px']]}],
      ],
      {idle: 0, active: ACTIVE},
    ),
  ).toEqual({idle: '10', active: '40'});
});

test('a StyleX block and a conditional value rank their conditions as one', () => {
  // StyleX compiles both forms to the same rules, where `:active` outranks
  // `:hover` whichever form states it
  const ranks = {idle: 0, hover: HOVER, both: HOVER + ACTIVE};
  expect(
    heightsByState(
      [
        ['width', 10],
        [
          'height',
          {
            c: [
              ['default', '10px'],
              [':active', '40px'],
            ],
          },
        ],
        [':hover', {c: [['height', '20px']]}],
      ],
      ranks,
    ),
  ).toEqual({idle: '10', hover: '20', both: '40'});
  expect(
    heightsByState(
      [
        ['width', 10],
        [
          'height',
          {
            c: [
              ['default', '10px'],
              [':hover', '20px'],
            ],
          },
        ],
        [':active', {c: [['height', '40px']]}],
      ],
      ranks,
    ),
  ).toEqual({idle: '10', hover: '20', both: '40'});
});

test('a StyleX @media block declares what it holds where the query matches', () => {
  expect(
    heightsByState(
      [
        ['width', 10],
        ['height', 10],
        ['@media (min-width: 1px)', {c: [['height', '30px']]}],
        ['@media (max-width: 1px)', {c: [['width', '50px']]}],
      ],
      {idle: 0},
    ),
  ).toEqual({idle: '30'});
});

test('a StyleX block holds conditional values and blocks of its own', () => {
  expect(
    heightsByState(
      [
        ['width', 10],
        ['height', 10],
        [
          ':active',
          {
            c: [
              [
                'height',
                {
                  c: [
                    ['default', '40px'],
                    ['@media (max-width: 1px)', '50px'],
                  ],
                },
              ],
            ],
          },
        ],
        [
          '@media (min-width: 1px)',
          {c: [[':hover', {c: [['height', '20px']]}]]},
        ],
      ],
      {idle: 0, hover: HOVER, active: ACTIVE},
    ),
  ).toEqual({idle: '10', hover: '20', active: '40'});
});

test('a sheet orders flex items by an integer, a negative order first', () => {
  // `order: <integer>` (css-flexbox-1 §5.4); 3.5 is not one, and is dropped
  engine().addStyleSheet(
    '.ordered-row { display: flex; flex-direction: row; width: 300px; } ' +
      '.ordered-item { width: 100px; height: 10px; } ' +
      '.ordered-first { order: -1; } .ordered-last { order: 2; } ' +
      '.ordered-invalid { order: 3.5; }',
  );
  const a = createRef<HostInstance>();
  const b = createRef<HostInstance>();
  const c = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="ordered-row">
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={a} cssEngine={true} cssClass="ordered-item ordered-last" />
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={b} cssEngine={true} cssClass="ordered-item ordered-invalid" />
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={c} cssEngine={true} cssClass="ordered-item ordered-first" />
      </div>,
    );
  });
  expect(rect(c)).toBe('x=0 y=0 w=100 h=10');
  expect(rect(b)).toBe('x=100 y=0 w=100 h=10');
  expect(rect(a)).toBe('x=200 y=0 w=100 h=10');
});

test('a sheet added after the first render restyles the committed tree', () => {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssClass="late" />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=390 h=0');
  Fantom.runTask(() => {
    engine().addStyleSheet('.late { height: 17px; }');
    // No commit follows the change here, as a page rendering with it would
    engine().flush();
  });
  expect(rect(ref)).toBe('x=0 y=0 w=390 h=17');
});

test('an unchanged sibling keeps its styled node across a re-render', () => {
  const kept = createRef<HostInstance>();
  const changed = createRef<HostInstance>();
  const root = Fantom.createRoot();
  function render(height: number) {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={kept} cssEngine={true} cssClass="sized" />
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={changed} cssEngine={true} cssInline={[['height', height]]} />
      </div>,
    );
  }
  Fantom.runTask(() => render(5));
  expect(rect(changed)).toBe('x=0 y=40 w=390 h=5');
  Fantom.runTask(() => render(9));
  expect(rect(kept)).toBe('x=0 y=0 w=120 h=40');
  expect(rect(changed)).toBe('x=0 y=40 w=390 h=9');
});

test('computedStyle and matches answer from the last pass', () => {
  engine().addStyleSheet('.colored { background-color: rgb(255, 0, 0); }');
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="wrap">
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={ref} cssEngine={true} cssClass="colored" />
      </div>,
    );
  });
  // The host instance's shadow node
  const node = (ref.current as $FlowFixMe)?.__internalInstanceHandle?.stateNode
    ?.node;
  const computed = engine().computedStyle(node);
  // React Native's packed colour, a signed 32-bit 0xAARRGGBB, which Android
  // reads as an `int`: 0xFFFF0000
  expect(computed?.backgroundColor).toBe(-0x10000);
  expect(engine().matches(node, '.wrap > .colored')).toBe(true);
  expect(engine().matches(node, '.wrap > .other')).toBe(false);
});

test('an important declaration in an earlier layer beats a later layer', () => {
  engine().addStyleSheet(
    '@layer first, second; @layer first { .ranked { height: 11px !important; } } @layer second { .ranked { height: 99px !important; width: 7px; } } .ranked { height: 50px; }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssClass="ranked" />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=7 h=11');
});

test('tokens are the root custom properties, under a :root rule', () => {
  engine().registerTokens([
    ['--token-size', '13px'],
    ['--token-other', 'var(--token-size)'],
  ]);
  engine().addStyleSheet(
    ':root { --token-root: 21px; } .tokened { width: var(--token-other); height: var(--token-root); }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssClass="tokened" />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=13 h=21');
});

test('a presentation attribute sits under every rule', () => {
  engine().addStyleSheet('.icon-sized { width: 24px; }');
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        ref={ref}
        cssEngine={true}
        cssTag="svg"
        cssClass="icon-sized"
        cssPresentational={[
          ['width', '2em'],
          ['height', '1.5em'],
        ]}
      />,
    );
  });
  // 1.5em of the initial 16px font size
  expect(rect(ref)).toBe('x=0 y=0 w=24 h=24');
});

test('the tag a host names for itself is the one selectors see', () => {
  engine().addStyleSheet('svg.tagged { height: 6px; }');
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssTag="svg" cssClass="tagged" />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=390 h=6');
});

test('an inline value in React Native form is written as it is', () => {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        ref={ref}
        cssEngine={true}
        cssInline={[
          ['width', 40],
          ['height', 20],
          ['transform', {r: [{translateX: 5}]}],
        ]}
      />,
    );
  });
  expect(rect(ref)).toBe('x=5 y=0 w=40 h=20');
});

test('a block that overflows in the block axis grows to its content', () => {
  engine().addStyleSheet(
    '.pane { height: 30px; max-height: 30px; overflow-y: auto; } .tall { height: 80px; }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={ref} cssEngine={true} cssClass="pane">
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="tall" />
      </div>,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=390 h=80');
});

test('in the top layer the same block keeps its height', () => {
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssInline={[['--astryx-in-top-layer', '1']]}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={ref} cssEngine={true} cssClass="pane">
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssClass="tall" />
        </div>
      </div>,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=390 h=30');
});

test('below a box that clips its block axis the same block keeps its height', () => {
  // What it grew by would be cut off there, out of the page's reach
  engine().addStyleSheet(
    '.clips-block { overflow: hidden; } .clips-inline { overflow-x: hidden; }',
  );
  const clipped = createRef<HostInstance>();
  const sideways = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="clips-block">
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true}>
            {/* $FlowExpectedError[prop-missing] */}
            <div ref={clipped} cssEngine={true} cssClass="pane">
              {/* $FlowExpectedError[prop-missing] */}
              <div cssEngine={true} cssClass="tall" />
            </div>
          </div>
        </div>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="clips-inline">
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={sideways} cssEngine={true} cssClass="pane">
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} cssClass="tall" />
          </div>
        </div>
      </>,
    );
  });
  expect(rect(clipped)).toBe('x=0 y=0 w=390 h=30');
  // A box that clips its inline axis only leaves the block axis to the page
  expect(rect(sideways)).toBe('x=0 y=30 w=390 h=80');
});

test("a scroll container's box keeps its size and its content takes the padding", () => {
  engine().addStyleSheet(
    '.strip { width: 200px; padding: 9px; display: flex; flex-direction: row; overflow-x: auto; background-color: red; } .cell { width: 150px; height: 10px; flex-shrink: 0; }',
  );
  const box = createRef<HostInstance>();
  const content = createRef<HostInstance>();
  const second = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={box} cssEngine={true} cssClass="strip" cssScroll={1}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={content} cssEngine={true} cssScroll={3}>
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssClass="cell" />
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={second} cssEngine={true} cssClass="cell" />
        </div>
      </div>,
    );
  });
  expect(rect(box)).toBe('x=0 y=0 w=200 h=28');
  // The content lays the cells out in a row inside its own padding
  expect(rect(second)).toBe('x=159 y=9 w=150 h=10');
  // $FlowExpectedError[prop-missing] the host instance's shadow node
  const boxNode = (box.current as $FlowFixMe)?.__internalInstanceHandle
    ?.stateNode?.node;
  expect(engine().computedStyle(boxNode)?.paddingTop).toBe(undefined);
  expect(engine().computedStyle(boxNode)?.backgroundColor).toBe(-0x10000);
});

test("an explicit inherit reads the parent's value, and a parent's other props leave its subtree be", () => {
  // `inherit` on a property that does not inherit takes the parent's computed
  // value (css-cascade-5 §7.2); it is the only reason an element keeps any of
  // its props for its descendants, so a change to a prop nobody inherits (a
  // width a table plugin writes after measuring) must not re-resolve them
  engine().addStyleSheet(
    '.inherits-radius { border-radius: inherit; width: 20px; height: 20px; }' +
      ' .rounded { border-radius: 7px; }',
  );
  const child = createRef<HostInstance>();
  const root = Fantom.createRoot();
  const render = (width: number) =>
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[prop-missing]
        <div cssEngine={true} cssClass="rounded" style={{width}}>
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={child} cssEngine={true} cssClass="inherits-radius">
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} style={{height: 5}} />
          </div>
        </div>,
      );
    });
  render(100);
  // $FlowExpectedError[prop-missing] the host instance's shadow node
  const childNode = (child.current as $FlowFixMe)?.__internalInstanceHandle
    ?.stateNode?.node;
  expect(engine().computedStyle(childNode)?.borderTopLeftRadius).toBe(7);
  const before = engine().stats();
  render(200);
  const after = engine().stats();
  // The parent re-resolved for its new width; the child and grandchild kept
  // their resolutions, since nothing they can read of the parent changed
  expect(after.resolvedProps - before.resolvedProps).toBe(1);
  expect(after.resolvedParent - before.resolvedParent).toBe(0);
  expect(engine().computedStyle(childNode)?.borderTopLeftRadius).toBe(7);
});

test('a custom property rewritten on an ancestor re-resolves its readers, and nothing else', () => {
  // A table's resize plugin rewrites `--table-resize-height` on each resize;
  // only the handles read it, so only they resolve again. Every other element
  // under the table keeps its resolution although its parent context is a new
  // object (the pass's `keptAcrossParent`).
  engine().addStyleSheet(
    '.reader { height: var(--probe-height); width: 10px; }' +
      ' .bystander { width: 12px; height: 12px; }' +
      ' .probe-30 { --probe-height: 30px; } .probe-40 { --probe-height: 40px; }',
  );
  const reader = createRef<HostInstance>();
  const root = Fantom.createRoot();
  const render = (scopeClass: string) =>
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[prop-missing]
        <div cssEngine={true} cssClass={scopeClass}>
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssClass="bystander">
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} cssClass="bystander" />
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} cssClass="bystander" />
          </div>
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={reader} cssEngine={true} cssClass="reader" />
        </div>,
      );
    });
  render('probe-30');
  expect(rect(reader)).toBe('x=0 y=12 w=10 h=30');
  const before = engine().stats();
  render('probe-40');
  const after = engine().stats();
  expect(rect(reader)).toBe('x=0 y=12 w=10 h=40');
  // The ancestor for its new declaration, the reader for the value it reads
  expect(after.resolvedProps - before.resolvedProps).toBe(1);
  expect(after.resolvedParent - before.resolvedParent).toBe(1);
  expect(after.elementsKeptAcrossParent - before.elementsKeptAcrossParent).toBe(
    3,
  );
});

/* eslint-disable no-bitwise */
test('the overflow shorthand hints a sideways scroll on a flex row alone', () => {
  // The bits of `StyleHint` in StyleEngine.h. The class names are this
  // test's own: the suite's sheets outlive the test that adds them.
  const HINT_SCROLL = 2;
  const HINT_SCROLL_BLOCK = 64;
  const HINT_FLEX_ROW = 128;
  const HINT_FLEX_COLUMN = 256;
  engine().addStyleSheet(
    '.hint-row { display: flex; overflow: auto; }' +
      ' .hint-pane { display: flex; flex-direction: column; overflow: auto; }' +
      ' .hint-wrapping { display: flex; flex-flow: row wrap; overflow: auto; }' +
      ' .hint-tight { display: flex; flex-wrap: nowrap; overflow: auto; }' +
      ' .hint-sideways { overflow-x: auto; }',
  );
  const hints = (className: string) =>
    engine().hints('div', className, null, 0, null);
  // A row: the shorthand may scroll sideways, as the runtime reads the bits
  expect(hints('hint-row') & (HINT_SCROLL_BLOCK | HINT_FLEX_ROW)).toBe(
    HINT_SCROLL_BLOCK | HINT_FLEX_ROW,
  );
  expect(hints('hint-row') & HINT_FLEX_COLUMN).toBe(0);
  expect(hints('hint-tight') & HINT_FLEX_COLUMN).toBe(0);
  // A column and a wrapping row stay block-axis regions
  expect(hints('hint-pane') & HINT_FLEX_COLUMN).toBe(HINT_FLEX_COLUMN);
  expect(hints('hint-wrapping') & HINT_FLEX_COLUMN).toBe(HINT_FLEX_COLUMN);
  // An explicit overflow-x is the sideways hint itself
  expect(hints('hint-sideways') & HINT_SCROLL).toBe(HINT_SCROLL);
  expect(hints('hint-row') & HINT_SCROLL).toBe(0);
});

test('a block axis that may be clipped is hinted, which the runtime passes down', () => {
  // `StyleHintClipBlock` in StyleEngine.h
  const HINT_CLIP_BLOCK = 512;
  engine().addStyleSheet(
    '.hint-hidden { overflow: hidden; } .hint-clip-y { overflow-y: clip; }' +
      ' .hint-clip-x { overflow: hidden auto; } .hint-clip-only-x { overflow-x: clip; }',
  );
  const hints = (className: string) =>
    engine().hints('div', className, null, 0, null) & HINT_CLIP_BLOCK;
  expect(hints('hint-hidden')).toBe(HINT_CLIP_BLOCK);
  expect(hints('hint-clip-y')).toBe(HINT_CLIP_BLOCK);
  // The shorthand's block axis is its second value
  expect(hints('hint-clip-x')).toBe(0);
  expect(hints('hint-clip-only-x')).toBe(0);
});
/* eslint-enable no-bitwise */

test("a scroll container's scroll view fills its box only where the box's size is set", () => {
  // Built as the runtime builds one: the box, the platform's scroll view, and
  // the element inside it. The parent offers its whole height and sizes the
  // boxes to fit their content, as a chat bubble does.
  engine().addStyleSheet(
    '.offer { display: flex; flex-direction: column; align-items: flex-start; width: 300px; height: 600px; }' +
      ' .sideways { overflow-x: auto; } .set { height: 60px; } .wide { width: 500px; height: 40px; }' +
      ' .columns { display: grid; grid-template-columns: 30px 70px; } .grid-cell { height: 10px; }',
  );
  const auto = createRef<HostInstance>();
  const set = createRef<HostInstance>();
  const setScroll = createRef<React.ElementRef<typeof ScrollView>>();
  const cell = createRef<HostInstance>();
  const scrollContainer = (
    className: string,
    ref: {current: HostInstance | null},
    children: React.Node,
    scrollRef?: {current: React.ElementRef<typeof ScrollView> | null},
  ) => (
    // $FlowExpectedError[prop-missing]
    <div ref={ref} cssEngine={true} cssClass={className} cssScroll={1}>
      <ScrollView ref={scrollRef} horizontal={true}>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssScroll={3}>
          {children}
        </div>
      </ScrollView>
    </div>
  );
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="offer">
        {scrollContainer(
          'sideways',
          auto,
          // $FlowExpectedError[prop-missing]
          <div cssEngine={true} cssClass="wide" />,
        )}
        {scrollContainer(
          'sideways set',
          set,
          // $FlowExpectedError[prop-missing]
          <div cssEngine={true} cssClass="wide" />,
          setScroll,
        )}
        {scrollContainer(
          'sideways columns',
          createRef<HostInstance>(),
          <>
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} cssClass="grid-cell" />
            {/* $FlowExpectedError[prop-missing] */}
            <div ref={cell} cssEngine={true} cssClass="grid-cell" />
          </>,
        )}
      </div>,
    );
  });
  // As tall as its content, not as the 600 points on offer
  expect(rect(auto)).toBe('x=0 y=0 w=300 h=40');
  // The scroll view fills a box whose height is set
  expect(rect(set)).toBe('x=0 y=40 w=300 h=60');
  // $FlowExpectedError[incompatible-use] the scroll view's host instance
  const scrollport = setScroll.current?.getBoundingClientRect();
  expect(scrollport?.height).toBe(60);
  // A grid container's template lays out its content, not its box
  expect(rect(cell)).toBe('x=30 y=100 w=70 h=10');
});

test("a scroll container's box clips what it holds", () => {
  // The scroll view clips to its own rectangle only, so the box clips to its
  // corners: a card in Product Detail drew its image's corners square past
  // its own
  engine().addStyleSheet(
    '.card { overflow-x: auto; border-radius: 12px; background-color: white; height: 60px; }',
  );
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="card" cssScroll={1}>
        <ScrollView horizontal={true}>
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssScroll={3} />
        </ScrollView>
      </div>,
    );
  });
  const box = root
    .getRenderedOutput({props: ['overflow', 'backgroundColor']})
    .toJSONObject();
  expect(box.props.overflow).toBe('hidden');
  const [scrollView] = box.children;
  expect(typeof scrollView === 'string' ? scrollView : scrollView?.type).toBe(
    'ScrollView',
  );
});

test("a grid's track list has its lengths in points", () => {
  // The renderer's track list parser reads `px`, percentages and `fr`; the
  // second list is Astryx's grid capped at three columns, with a gap of
  // `0.5rem`, which Settings Dialog's theme cards are laid out in
  engine().addStyleSheet(
    '.tracks { display: grid; width: 316px; gap: 0.5rem; }' +
      ' .rem { grid-template-columns: repeat(3, 6.25rem); }' +
      ' .capped { grid-template-columns: repeat(auto-fill, minmax(min(100%, max(96px, calc((100% - 2 * 0.5rem) / 3))), 1fr)); }' +
      ' .track-cell { height: 10px; }',
  );
  for (const template of ['rem', 'capped']) {
    const cells = [
      createRef<HostInstance>(),
      createRef<HostInstance>(),
      createRef<HostInstance>(),
    ];
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[prop-missing]
        <div cssEngine={true} cssClass={`tracks ${template}`}>
          {cells.map((ref, index) => (
            // $FlowExpectedError[prop-missing]
            <div key={index} ref={ref} cssEngine={true} cssClass="track-cell" />
          ))}
        </div>,
      );
    });
    expect(cells.map(rect)).toEqual([
      'x=0 y=0 w=100 h=10',
      'x=108 y=0 w=100 h=10',
      'x=216 y=0 w=100 h=10',
    ]);
    Fantom.runTask(() => root.destroy());
  }
});

test('a percentage in a math function is resolved by layout', () => {
  // `max(80%, 17.5rem)` is a chat bubble's cap: 280px in a 300px column,
  // where 80% is less, and 320px in a 400px one
  engine().addStyleSheet(
    '.math-column { width: 300px; display: flex; flex-direction: column; align-items: flex-start; }' +
      ' .math-wide { width: 400px; }' +
      ' .math-bubble { width: 1000px; height: 10px; max-width: max(80%, 17.5rem); }' +
      ' .math-inset { height: 10px; margin-left: calc(50% - 1rem); width: calc(100% - 50% - 2rem); }',
  );
  const narrow = createRef<HostInstance>();
  const wide = createRef<HostInstance>();
  const inset = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="math-column">
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={narrow} cssEngine={true} cssClass="math-bubble" />
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={inset} cssEngine={true} cssClass="math-inset" />
        </div>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="math-column math-wide">
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={wide} cssEngine={true} cssClass="math-bubble" />
        </div>
      </>,
    );
  });
  expect(rect(narrow)).toBe('x=0 y=0 w=280 h=10');
  expect(rect(wide)).toBe('x=0 y=20 w=320 h=10');
  // 150 - 16 from the left, and 300 - 150 - 32 wide
  expect(rect(inset)).toBe('x=134 y=10 w=118 h=10');
});

test('the viewport a host declares answers media queries and viewport units below it', () => {
  engine().addStyleSheet(
    '.responsive { width: 50vw; height: 4px; } @media (max-width: 300px) { .responsive { height: 8px; } }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        cssEngine={true}
        cssInline={[
          ['--astryx-viewport-inline-size', '200px'],
          ['--astryx-viewport-block-size', '400px'],
        ]}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={ref} cssEngine={true} cssClass="responsive" />
      </div>,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=100 h=8');
});

test("a fixed or top-layer element's percentages are the viewport's", () => {
  // A fixed element's containing block is the viewport (CSS 2.1 §10.1), and
  // so is a top-layer element's (css-position-4 §3.2), whatever box each is
  // laid out in: a modal sheet's is a handle of no height
  engine().addStyleSheet(
    '.fixed-pane { position: fixed; top: 0; left: 0; width: 100%; height: calc(100% - 20px); }' +
      ' .fixed-padded { position: fixed; top: 0; left: 0; height: 0; padding-top: 10%; }' +
      ' .no-height { position: absolute; top: 0; left: 0; width: 100px; height: 0; }' +
      ' .sheet { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }' +
      ' .half { position: absolute; top: 0; left: 0; width: 50%; height: 100%; }',
  );
  const fixed = createRef<HostInstance>();
  const padded = createRef<HostInstance>();
  const sheet = createRef<HostInstance>();
  const half = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        cssEngine={true}
        cssInline={[
          ['--astryx-viewport-inline-size', '200px'],
          ['--astryx-viewport-block-size', '400px'],
        ]}>
        {/* $FlowExpectedError[prop-missing] */}
        <div
          cssEngine={true}
          cssInline={[
            ['position', 'relative'],
            ['width', '100px'],
            ['height', '50px'],
          ]}>
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={fixed} cssEngine={true} cssClass="fixed-pane" />
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={padded} cssEngine={true} cssClass="fixed-padded" />
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssClass="no-height">
            {/* $FlowExpectedError[prop-missing] */}
            <div
              ref={sheet}
              cssEngine={true}
              cssClass="sheet"
              cssInline={[['--astryx-in-top-layer', '1']]}
            />
          </div>
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={half} cssEngine={true} cssClass="half" />
        </div>
      </div>,
    );
  });
  expect(rect(fixed)).toBe('x=0 y=0 w=200 h=380');
  // Padding takes the width (CSS 2.1 §8.4)
  expect(padded.current?.getBoundingClientRect().height).toBe(20);
  expect(rect(sheet)).toBe('x=0 y=0 w=200 h=400');
  // An absolute element's are still its containing block's
  expect(rect(half)).toBe('x=0 y=0 w=50 h=50');
});

test('an ancestor attribute a rule names restyles the descendants', () => {
  engine().addStyleSheet('.watched[data-open] .kid { height: 5px; }');
  const kid = createRef<HostInstance>();
  const root = Fantom.createRoot();
  function render(open: boolean) {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        cssEngine={true}
        cssClass="watched"
        cssAttributes={open ? {'data-open': ''} : {}}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={kid} cssEngine={true} cssClass="kid" />
      </div>,
    );
  }
  Fantom.runTask(() => render(false));
  expect(rect(kid)).toBe('x=0 y=0 w=390 h=0');
  Fantom.runTask(() => render(true));
  expect(rect(kid)).toBe('x=0 y=0 w=390 h=5');
});

test('an ancestor attribute no rule names leaves the descendants as they were', () => {
  const root = Fantom.createRoot();
  function render(value: string) {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssAttributes={{'data-unread': value}}>
        {/* $FlowExpectedError[prop-missing] */}
        <div cssEngine={true} cssClass="sized">
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssClass="sized" />
        </div>
      </div>,
    );
  }
  Fantom.runTask(() => render('a'));
  engine().resetStats();
  Fantom.runTask(() => render('b'));
  const stats = engine().stats();
  // The element itself, and nothing under it
  expect(stats.elementsResolved).toBe(1);
  expect(stats.childContextsKept).toBe(1);
});

function reportsEvents(): void {}

test('a press restyles the element and its stateful ancestor, with no render', () => {
  engine().addStyleSheet(
    '.press { width: 10px; height: 10px; } .press:active { height: 30px; } ' +
      '.label { width: 5px; height: 5px; } .press:active .label { width: 7px; }',
  );
  const button = createRef<HostInstance>();
  const label = createRef<HostInstance>();
  let renders = 0;
  function Button(): React.Node {
    renders++;
    return (
      // $FlowExpectedError[prop-missing]
      <div
        ref={button}
        cssEngine={true}
        cssClass="press"
        cssStateful={true}
        onPointerDown={reportsEvents}
        onPointerUp={reportsEvents}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={label} cssEngine={true} cssClass="label" />
      </div>
    );
  }
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(<Button />);
  });
  expect(rect(button)).toBe('x=0 y=0 w=10 h=10');

  // Pressed where the label is: `:active` reaches the label's ancestors
  Fantom.dispatchNativeEvent(label, 'pointerDown');
  expect(rect(button)).toBe('x=0 y=0 w=10 h=30');
  expect(rect(label)).toBe('x=0 y=0 w=7 h=5');

  Fantom.dispatchNativeEvent(label, 'pointerUp');
  expect(rect(button)).toBe('x=0 y=0 w=10 h=10');
  expect(rect(label)).toBe('x=0 y=0 w=5 h=5');
  expect(renders).toBe(1);
  expect(engine().stats().stateCommits).toBeGreaterThan(0);
});

test('hover follows the pointer entering and leaving a StyleX element', () => {
  const styleId = engine().registerStyle([
    ['width', 10],
    [
      'height',
      {
        c: [
          ['default', '10px'],
          [':hover', '20px'],
        ],
      },
    ],
  ]);
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        ref={ref}
        cssEngine={true}
        cssStyle={styleId}
        cssStateful={true}
        onPointerEnter={reportsEvents}
        onPointerLeave={reportsEvents}
      />,
    );
  });
  expect(rect(ref)).toBe('x=0 y=0 w=10 h=10');
  Fantom.dispatchNativeEvent(ref, 'pointerEnter');
  expect(rect(ref)).toBe('x=0 y=0 w=10 h=20');
  Fantom.dispatchNativeEvent(ref, 'pointerLeave');
  expect(rect(ref)).toBe('x=0 y=0 w=10 h=10');
});

test('a disabled element has no interaction states', () => {
  engine().addStyleSheet(
    '.inert { width: 10px; height: 10px; } .inert:active { height: 30px; }',
  );
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        ref={ref}
        cssEngine={true}
        cssClass="inert"
        cssAttributes={{disabled: true}}
        cssStateful={true}
        onPointerDown={reportsEvents}
      />,
    );
  });
  Fantom.dispatchNativeEvent(ref, 'pointerDown');
  expect(rect(ref)).toBe('x=0 y=0 w=10 h=10');
  Fantom.dispatchNativeEvent(ref, 'pointerUp');
});

test('matches() reads the states the engine keeps', () => {
  engine().addStyleSheet('.held { width: 10px; height: 10px; }');
  const ref = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div
        ref={ref}
        cssEngine={true}
        cssClass="held"
        cssStateful={true}
        onPointerDown={reportsEvents}
      />,
    );
  });
  const node = (ref.current as $FlowFixMe)?.__internalInstanceHandle?.stateNode
    ?.node;
  expect(engine().matches(node, '.held:active')).toBe(false);
  Fantom.dispatchNativeEvent(ref, 'pointerDown');
  expect(engine().matches(node, '.held:active')).toBe(true);
  Fantom.dispatchNativeEvent(ref, 'pointerUp');
  expect(engine().matches(node, '.held:active')).toBe(false);
});

test('pointer-events: none leaves a descendant that restores auto a target', () => {
  // CSS's `none` takes the element alone out of hit testing and inherits, so
  // a dock that passes touches through still has a composer that takes them;
  // React Native's `none` would take the whole subtree out, and its
  // `box-none` is the element alone
  engine().addStyleSheet(
    '.dock { pointer-events: none; width: 100px; height: 40px; } ' +
      '.composer { pointer-events: auto; width: 50px; height: 20px; } ' +
      '.blur { width: 10px; height: 10px; }',
  );
  const dock = createRef<HostInstance>();
  const blur = createRef<HostInstance>();
  const composer = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div ref={dock} cssEngine={true} cssClass="dock">
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={blur} cssEngine={true} cssClass="blur" />
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={composer} cssEngine={true} cssClass="composer" />
      </div>,
    );
  });
  const pointerEventsOf = (ref: {current: HostInstance | null}) =>
    engine().computedStyle(
      (ref.current as $FlowFixMe)?.__internalInstanceHandle?.stateNode?.node,
    )?.pointerEvents;
  expect(pointerEventsOf(dock)).toBe('box-none');
  expect(pointerEventsOf(blur)).toBe('box-none');
  expect(pointerEventsOf(composer)).toBe('auto');
});

test("an explicit inherit reads the parent's value, and a parent's other props leave its subtree be", () => {
  // `inherit` on a property that does not inherit takes the parent's computed
  // value (css-cascade-5 §7.2); it is the only reason an element keeps any of
  // its props for its descendants, so a change to a prop nobody inherits (a
  // width a table plugin writes after measuring) must not re-resolve them
  engine().addStyleSheet(
    '.inherits-radius { border-radius: inherit; width: 20px; height: 20px; }' +
      ' .rounded { border-radius: 7px; }',
  );
  const child = createRef<HostInstance>();
  const root = Fantom.createRoot();
  const render = (width: number) =>
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[prop-missing]
        <div cssEngine={true} cssClass="rounded" style={{width}}>
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={child} cssEngine={true} cssClass="inherits-radius">
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} style={{height: 5}} />
          </div>
        </div>,
      );
    });
  render(100);
  // $FlowExpectedError[prop-missing] the host instance's shadow node
  const childNode = (child.current as $FlowFixMe)?.__internalInstanceHandle
    ?.stateNode?.node;
  expect(engine().computedStyle(childNode)?.borderTopLeftRadius).toBe(7);
  const before = engine().stats();
  render(200);
  const after = engine().stats();
  // The parent re-resolved for its new width; the child and grandchild kept
  // their resolutions, since nothing they can read of the parent changed
  expect(after.resolvedProps - before.resolvedProps).toBe(1);
  expect(after.resolvedParent - before.resolvedParent).toBe(0);
  expect(engine().computedStyle(childNode)?.borderTopLeftRadius).toBe(7);
});

test('a custom property rewritten on an ancestor re-resolves its readers, and nothing else', () => {
  // A table's resize plugin rewrites `--table-resize-height` on each resize;
  // only the handles read it, so only they resolve again. Every other element
  // under the table keeps its resolution although its parent context is a new
  // object (the pass's `keptAcrossParent`).
  engine().addStyleSheet(
    '.reader { height: var(--probe-height); width: 10px; }' +
      ' .bystander { width: 12px; height: 12px; }' +
      ' .probe-30 { --probe-height: 30px; } .probe-40 { --probe-height: 40px; }',
  );
  const reader = createRef<HostInstance>();
  const root = Fantom.createRoot();
  const render = (scopeClass: string) =>
    Fantom.runTask(() => {
      root.render(
        // $FlowExpectedError[prop-missing]
        <div cssEngine={true} cssClass={scopeClass}>
          {/* $FlowExpectedError[prop-missing] */}
          <div cssEngine={true} cssClass="bystander">
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} cssClass="bystander" />
            {/* $FlowExpectedError[prop-missing] */}
            <div cssEngine={true} cssClass="bystander" />
          </div>
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={reader} cssEngine={true} cssClass="reader" />
        </div>,
      );
    });
  render('probe-30');
  expect(rect(reader)).toBe('x=0 y=12 w=10 h=30');
  const before = engine().stats();
  render('probe-40');
  const after = engine().stats();
  expect(rect(reader)).toBe('x=0 y=12 w=10 h=40');
  // The ancestor for its new declaration, the reader for the value it reads
  expect(after.resolvedProps - before.resolvedProps).toBe(1);
  expect(after.resolvedParent - before.resolvedParent).toBe(1);
  expect(after.elementsKeptAcrossParent - before.elementsKeptAcrossParent).toBe(
    3,
  );
});

/* eslint-disable no-bitwise */
test('the overflow shorthand hints a sideways scroll on a flex row alone', () => {
  // The bits of `StyleHint` in StyleEngine.h. The class names are this
  // test's own: the suite's sheets outlive the test that adds them.
  const HINT_SCROLL = 2;
  const HINT_SCROLL_BLOCK = 64;
  const HINT_FLEX_ROW = 128;
  const HINT_FLEX_COLUMN = 256;
  engine().addStyleSheet(
    '.hint-row { display: flex; overflow: auto; }' +
      ' .hint-pane { display: flex; flex-direction: column; overflow: auto; }' +
      ' .hint-wrapping { display: flex; flex-flow: row wrap; overflow: auto; }' +
      ' .hint-tight { display: flex; flex-wrap: nowrap; overflow: auto; }' +
      ' .hint-sideways { overflow-x: auto; }',
  );
  const hints = (className: string) =>
    engine().hints('div', className, null, 0, null);
  // A row: the shorthand may scroll sideways, as the runtime reads the bits
  expect(hints('hint-row') & (HINT_SCROLL_BLOCK | HINT_FLEX_ROW)).toBe(
    HINT_SCROLL_BLOCK | HINT_FLEX_ROW,
  );
  expect(hints('hint-row') & HINT_FLEX_COLUMN).toBe(0);
  expect(hints('hint-tight') & HINT_FLEX_COLUMN).toBe(0);
  // A column and a wrapping row stay block-axis regions
  expect(hints('hint-pane') & HINT_FLEX_COLUMN).toBe(HINT_FLEX_COLUMN);
  expect(hints('hint-wrapping') & HINT_FLEX_COLUMN).toBe(HINT_FLEX_COLUMN);
  // An explicit overflow-x is the sideways hint itself
  expect(hints('hint-sideways') & HINT_SCROLL).toBe(HINT_SCROLL);
  expect(hints('hint-row') & HINT_SCROLL).toBe(0);
});
/* eslint-enable no-bitwise */
