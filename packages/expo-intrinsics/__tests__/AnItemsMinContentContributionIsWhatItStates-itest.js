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

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

type Style = {readonly [string]: string | number};

// A shrinking flex item stops at its min-content size (css-flexbox-1 §4.5),
// the sum of its children's min-content contributions (css-sizing-3 §5.1):
// the size a child states, else its content's, with an aspect ratio's
// transferred size and the child's minimum and maximum applied, and a
// percentage, which depends on the size being found, counted as `auto`
// (§5.2.1). Squeezed by a 180-point sibling in a row of 200; Safari measures
// the same.
function squeezed(child: Style, grandchild: Style): number {
  const item = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 200, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div ref={item} style={{display: 'flex', flexDirection: 'row'}}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={child}>
            {/* $FlowExpectedError[prop-missing] intrinsic */}
            <div style={grandchild} />
          </div>
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 180, height: 10, flexShrink: 0}} />
      </div>,
    );
  });
  return item.current?.getBoundingClientRect().width ?? -1;
}

test('an aspect ratio transfers the height a box states', () => {
  expect(
    squeezed(
      {aspectRatio: 1, height: 32, display: 'flex', flexShrink: 0},
      {width: 16, height: 16},
    ),
  ).toBe(32);
});

test('a stated minimum raises the contribution', () => {
  expect(
    squeezed({minWidth: 50, display: 'flex'}, {width: 10, height: 10}),
  ).toBe(50);
});

test('a stated maximum caps it', () => {
  expect(
    squeezed(
      {maxWidth: 40, display: 'flex'},
      {width: 80, height: 10, flexShrink: 0},
    ),
  ).toBe(40);
});

test('a percentage width counts as auto', () => {
  expect(
    squeezed(
      {width: '50%', display: 'flex'},
      {width: 30, height: 10, flexShrink: 0},
    ),
  ).toBe(30);
});

test('a box inside display: contents states its size', () => {
  expect(squeezed({display: 'contents'}, {width: 50, height: 10})).toBe(50);
});
