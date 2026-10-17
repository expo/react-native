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
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
// The vendored Grid is TypeScript and excluded from Flow; Metro compiles it.
// $FlowExpectedError[cannot-resolve-module]
import {Grid} from '../vendor/Grid';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function elementRef(): {current: $FlowFixMe} {
  return React.createRef();
}

it('reflows a stable grid when its native pane and column count change', () => {
  const root = Fantom.createRoot();
  const first = elementRef();
  const second = elementRef();
  function render(width: number, columns: number) {
    Fantom.runTask(() =>
      root.render(
        jsx('div', {
          ...stylex.props({
            display: 'grid',
            width,
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: 12,
          }),
          children: [first, second].map((ref, index) =>
            jsx(
              'div',
              {ref, style: {height: 40}, children: `Item ${index}`},
              index,
            ),
          ),
        }) as $FlowFixMe,
      ),
    );
  }
  render(800, 2);
  expect(second.current.getBoundingClientRect().x).toBeGreaterThan(300);
  render(280, 1);
  const a = first.current.getBoundingClientRect();
  const b = second.current.getBoundingClientRect();
  expect(b.x).toBe(a.x);
  expect(b.y).toBeGreaterThan(a.y);
  expect(a.width).toBe(280);
});

it('updates the gallery Grid column prop without remounting its items', () => {
  const root = Fantom.createRoot();
  const first = elementRef();
  const second = elementRef();
  function render(columns: number) {
    Fantom.runTask(() =>
      root.render(
        <Grid columns={columns} width={280}>
          {[first, second].map((ref, index) =>
            jsx(
              'div',
              {ref, style: {height: 40}, children: `Item ${index}`},
              index,
            ),
          )}
        </Grid>,
      ),
    );
  }
  render(2);
  expect(second.current.getBoundingClientRect().x).toBeGreaterThan(100);
  render(1);
  expect(second.current.getBoundingClientRect().x).toBe(
    first.current.getBoundingClientRect().x,
  );
});
