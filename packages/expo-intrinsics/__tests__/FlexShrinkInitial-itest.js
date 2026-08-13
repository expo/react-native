/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * CSS's `flex-shrink: 1` initial value holds for the elements.
 *
 * React Native's default is 0, so a flex item wider than its row OVERFLOWS
 * where a browser makes it yield — which is how a `<label>` beside a
 * checkbox in a demo's flex row clipped its text at the row's edge. The
 * initial-values table gives every registered element CSS's answer; an
 * author `flexShrink` still wins.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/expo-intrinsics-poc';

test('a label in a tight flex row yields instead of overflowing', () => {
  const root = Fantom.createRoot();
  const label = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      <View
        style={{
          width: 200,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
        }}>
        <View style={{width: 60, height: 30}} />
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <label ref={label}>
          Tapping this text does not toggle the box and is deliberately long
        </label>
      </View>,
    );
  });
  const rect = nullthrows(label.current).getBoundingClientRect();
  // The row leaves 200 - 60 - 14 = 126 for the label; shrinking means the
  // element's box stays inside it (and the text wraps within), never past
  // the row's right edge.
  expect(rect.right).toBeLessThanOrEqual(200);
});
