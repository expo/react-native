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
 * `vertical-align: super`/`sub`, `font-size: 13.3333px` against a 16px root,
 * which is the same 0.83 ratio `<small>` uses.
 */

import {uaStyleFor} from '../src/uaStyles';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

test('sup and sub are raised and lowered, and smaller', () => {
  expect(uaStyleFor('sup').verticalAlign).toBe('super');
  expect(uaStyleFor('sub').verticalAlign).toBe('sub');
  // 0.83em of a 16px root — Chrome reports 13.3333px.
  expect(uaStyleFor('sup').fontSize).toBeCloseTo(13.33, 1);
  expect(uaStyleFor('sub').fontSize).toBeCloseTo(13.33, 1);
});

test('they are smaller than surrounding text, not the same size', () => {
  // The regression that made them invisible: no font-size at all, so they
  // matched their parent exactly.
  const body = 16;
  expect(Number(uaStyleFor('sup').fontSize)).toBeLessThan(body);
  expect(Number(uaStyleFor('sub').fontSize)).toBeLessThan(body);
});
