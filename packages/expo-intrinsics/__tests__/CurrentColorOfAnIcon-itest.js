/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import {computedStyleForInstance} from '../../rn-tester/js/astryx/native-css/engine';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

type CSSEngine = {
  addStyleSheet: (text: string) => number,
  registerStyle: (entries: unknown) => number,
  computedStyle: (node: unknown) => ?{[string]: unknown},
};

function engine(): CSSEngine {
  // $FlowExpectedError[prop-missing] installed by the renderer
  const binding: ?CSSEngine = globalThis.__cssEngine;
  if (binding == null) {
    throw new Error('The renderer installed no __cssEngine binding.');
  }
  return binding;
}

function inheritedColorOf(ref: {current: HostInstance | null}): unknown {
  const node = (ref.current as $FlowFixMe)?.__internalInstanceHandle?.stateNode
    ?.node;
  return engine().computedStyle(node)?.__color;
}

// `currentColor` is the colour an element inherits (css-color-4 §7.1), and an
// icon's shapes are painted with it: an `<svg>` is a `div` host the engine
// styles, and the engine reports its colour as `__color`, however the ancestor
// stated that colour
test('an icon inherits a colour written as CSS text', () => {
  engine().addStyleSheet(
    '.inked-text { color: rgb(255, 0, 0); } .inherits-ink { color: inherit; }',
  );
  const icon = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="inked-text">
        {/* $FlowExpectedError[prop-missing] */}
        <span cssEngine={true} cssClass="inherits-ink">
          {/* $FlowExpectedError[prop-missing] */}
          <div ref={icon} cssEngine={true} cssClass="inherits-ink" />
        </span>
      </div>,
    );
  });
  expect(inheritedColorOf(icon)).toBe('rgb(255, 0, 0)');
});

test('an icon inherits a colour given as a platform colour value', () => {
  engine().addStyleSheet('.inherits-ink-2 { color: inherit; }');
  // A StyleX runtime hands the engine a value it already resolved as `{r}`:
  // here a colour, as the renderer's packed number
  const styleId = engine().registerStyle([['color', {r: 0xff00ff00}]]);
  const icon = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssStyle={styleId}>
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={icon} cssEngine={true} cssClass="inherits-ink-2" />
      </div>,
    );
  });
  expect(inheritedColorOf(icon)).toBe('rgba(0, 255, 0, 1)');
});

// What an `<svg>` reads to paint: the runtime's view of the element's computed
// style, whose `color` is the inherited one when the element says `inherit`
// (its own prop is then null, and the engine's object has no key order)
test('the runtime reports the inherited colour for an element saying inherit', () => {
  engine().addStyleSheet(
    '.inked-text-3 { color: rgb(0, 0, 255); } .inherits-ink-3 { color: inherit; }',
  );
  const icon = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing]
      <div cssEngine={true} cssClass="inked-text-3">
        {/* $FlowExpectedError[prop-missing] */}
        <div ref={icon} cssEngine={true} cssClass="inherits-ink-3" />
      </div>,
    );
  });
  const computed = computedStyleForInstance(icon.current);
  // The read logs the engine's counters on the queue the harness checks
  Fantom.runWorkLoop();
  expect(computed?.color).toBe('rgb(0, 0, 255)');
});
