/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
// $FlowExpectedError[untyped-import] Chat Demo's app components opt out of Flow.
import * as Composer from '../../../../chat-demo/Composer';
import {READABLE_COLUMN} from '../../../../chat-demo/layout';
import NativePageScroll from '../../../../expo-intrinsics/src/NativePageScroll';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';

it('centers the readable transcript after reserving each safe edge exactly once', () => {
  for (const [width, left, right, expectedX, expectedWidth] of [
    [466, 0, 84, 0, 382],
    [466, 84, 0, 84, 382],
    [874, 62, 62, 87, 700],
    [1376, 0, 84, 296, 700],
    [1376, 84, 0, 380, 700],
    [1376, 0, 0, 338, 700],
  ]) {
    const root = Fantom.createRoot({
      viewportWidth: width,
      viewportHeight: 1032,
      safeAreaInsets: {left, right},
    });
    const content: {current: $FlowFixMe} = React.createRef();
    Fantom.runTask(() =>
      root.render(
        <NativePageScroll contentContainerStyle={READABLE_COLUMN}>
          <View ref={content} style={{height: 100}} />
        </NativePageScroll>,
      ),
    );
    const rect = content.current.getBoundingClientRect();
    expect(rect.x).toBe(expectedX);
    expect(rect.width).toBe(expectedWidth);
  }
});

it('centers the actual composer inside the same safe readable column', () => {
  for (const [width, left, right, expectedX, expectedWidth] of [
    [466, 0, 84, 0, 382],
    [466, 84, 0, 84, 382],
    [874, 62, 62, 87, 700],
    [1376, 0, 84, 296, 700],
  ]) {
    const root = Fantom.createRoot({
      viewportWidth: width,
      viewportHeight: 1032,
      safeAreaInsets: {left, right},
    });
    const content: {current: $FlowFixMe} = React.createRef();
    Fantom.runTask(() =>
      root.render(
        <Composer.ComposerBar>
          <View ref={content} style={{height: 30}} />
        </Composer.ComposerBar>,
      ),
    );
    const rect = content.current.getBoundingClientRect();
    expect(rect.x).toBe(expectedX + Composer.COMPOSER_DOCKED_SIDE);
    expect(rect.width).toBe(expectedWidth - 2 * Composer.COMPOSER_DOCKED_SIDE);
  }
});
