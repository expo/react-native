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
  expect(computed?.backgroundColor).toBe(0xffff0000);
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
  expect(engine().computedStyle(boxNode)?.backgroundColor).toBe(0xffff0000);
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
