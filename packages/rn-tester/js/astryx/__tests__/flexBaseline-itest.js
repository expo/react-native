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

import {jsx, jsxs} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

function marker(ref) {
  return jsx('span', {
    ref,
    style: {display: 'inline-block', width: 1, height: 1},
  });
}

for (const overflow of ['visible', 'hidden']) {
  for (const hiddenFirst of [false, true]) {
    it(`exports the first flex item's text baseline with ${overflow} overflow, hidden first item: ${hiddenFirst}`, () => {
      const first = React.createRef<$FlowFixMe>();
      const outer = React.createRef<$FlowFixMe>();
      const root = Fantom.createRoot();
      Fantom.runTask(() =>
        root.render(
          jsxs('div', {
            style: {width: 600, fontSize: 60, lineHeight: '72px'},
            children: [
              'Hg ',
              jsxs('span', {
                style: {
                  display: 'inline-flex',
                  flexDirection: 'row',
                  fontSize: 10,
                  lineHeight: '12px',
                  alignItems: 'center',
                  height: 40,
                  overflow,
                },
                children: [
                  hiddenFirst
                    ? jsx('span', {
                        style: {display: 'none'},
                        children: 'ignored',
                      })
                    : null,
                  jsx('div', {
                    ref: first,
                    style: {
                      display: 'block',
                      fontSize: 10,
                      lineHeight: '12px',
                      overflow: 'hidden',
                    },
                    children: 'Hg',
                  }),
                  jsx('div', {
                    style: {display: 'block', fontSize: 30, lineHeight: '36px'},
                    children: 'Hg',
                  }),
                ],
              }),
              marker(outer),
            ],
          }) as $FlowFixMe,
        ),
      );
      // CSS Flexbox §8.5 uses the first item, even when a later item is taller.
      // Clipping either the item or the flex container preserves that baseline.
      // Fantom's deterministic text measurer puts the baseline at 80% of the
      // stated line height: 9.6 points below this item's content top.
      expect(outer.current.getBoundingClientRect().bottom).toBeCloseTo(
        first.current.getBoundingClientRect().y + 12 * 0.8,
        4,
      );
    });
  }
}

it('aligns a wrapped flex item by its first line', () => {
  const wrapped = React.createRef<$FlowFixMe>();
  const single = React.createRef<$FlowFixMe>();
  const root = Fantom.createRoot();
  Fantom.runTask(() =>
    root.render(
      jsxs('div', {
        style: {
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'baseline',
          width: 600,
        },
        children: [
          jsx('div', {
            ref: wrapped,
            style: {
              display: 'block',
              width: 20,
              paddingTop: 5,
              fontSize: 10,
              lineHeight: '15px',
            },
            children: 'HgHg',
          }),
          jsx('div', {
            ref: single,
            style: {display: 'block', fontSize: 30, lineHeight: '40px'},
            children: 'Hg',
          }),
        ],
      }) as $FlowFixMe,
    ),
  );
  const wrappedRect = wrapped.current.getBoundingClientRect();
  // The deterministic measurer fits two 10-point characters on each 15-point
  // line, below 5 points of padding.
  expect(wrappedRect.height).toBe(35);
  // A flex item aligns by its first baseline (css-flexbox-1 §8.5), unlike an
  // inline-block, which uses its last: 5 + 12 points into the wrapped item
  // against 32 into the other.
  expect(wrappedRect.y - single.current.getBoundingClientRect().y).toBeCloseTo(
    40 * 0.8 - (5 + 15 * 0.8),
    4,
  );
});
