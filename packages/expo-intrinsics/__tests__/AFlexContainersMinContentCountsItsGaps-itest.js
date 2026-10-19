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

// A shrinking flex item that is itself a flex container stops at its
// min-content size (css-flexbox-1 §4.5), which for a single line is its items
// plus the gaps between them, and for a wrapping one its widest item
// (css-flexbox-1 §9.9.1). Squeezed by a 180-point sibling in a row of 200.
function squeezed(wrap: boolean): number {
  const item = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowExpectedError[prop-missing] intrinsic
      <div style={{width: 200, display: 'flex', flexDirection: 'row'}}>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div
          ref={item}
          style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: wrap ? 'wrap' : 'nowrap',
            gap: 20,
          }}>
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{width: 50, height: 10, flexShrink: 0}} />
          {/* $FlowExpectedError[prop-missing] intrinsic */}
          <div style={{width: 50, height: 10, flexShrink: 0}} />
        </div>
        {/* $FlowExpectedError[prop-missing] intrinsic */}
        <div style={{width: 180, height: 10, flexShrink: 0}} />
      </div>,
    );
  });
  return item.current?.getBoundingClientRect().width ?? -1;
}

test('a single line counts its gaps', () => {
  expect(squeezed(false)).toBe(120);
});

test('a wrapping container is as narrow as its widest item', () => {
  expect(squeezed(true)).toBe(50);
});
