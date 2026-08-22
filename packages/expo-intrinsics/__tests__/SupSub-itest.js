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
 * `<sup>` and `<sub>` had no user-agent style at all.
 *
 * They were registered as inline-text elements and inherited from correctly,
 * so nothing errored — they simply rendered as ordinary text, which is the
 * hardest kind of missing feature to notice: the element "works", it just does
 * nothing.
 *
 * The values are Chrome's, read from `getComputedStyle` rather than recalled:
 * `vertical-align: super`/`sub` and `font-size: 0.8333em` — the same ratio
 * `<small>` uses. Chrome reports 13.3333px for that on a 16px root; the ratio
 * is the declaration, the pixels are one resolution of it.
 */

import {uaStyleFor} from '../src/uaStyles';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

test('sup and sub are raised and lowered, and smaller', () => {
  expect(uaStyleFor('sup').verticalAlign).toBe('super');
  expect(uaStyleFor('sub').verticalAlign).toBe('sub');
  // `font-size: 0.8333em` — a RATIO of the inherited size, not a fixed px
  // value. Chrome reports 13.3333px for it only because its root is 16px;
  // stating the ratio is what makes it right at every inherited size, and on
  // platforms whose root is not 16. See RelativeFontSize-itest for the
  // resolved sizes.
  expect(uaStyleFor('sup').fontSizeEm).toBeCloseTo(0.8333, 3);
  expect(uaStyleFor('sub').fontSizeEm).toBeCloseTo(0.8333, 3);
});

test('they are smaller than surrounding text, not the same size', () => {
  // The regression that made them invisible: no font-size at all, so they
  // matched their parent exactly.
  expect(Number(uaStyleFor('sup').fontSizeEm)).toBeLessThan(1);
  expect(Number(uaStyleFor('sub').fontSizeEm)).toBeLessThan(1);
});
