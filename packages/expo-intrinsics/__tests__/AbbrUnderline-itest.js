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
 * `<abbr>` is underlined with dots by the text stack, as Safari's
 * `getComputedStyle` reports for `<abbr title>`. A decoration rather than a
 * border, so a wrapped abbreviation is underlined on each line. Asserted on
 * the style: Fantom's measurer reports geometry, not decoration.
 */

import {uaStyleFor} from '../src/uaStyles';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

test('an abbreviation is underlined', () => {
  expect(uaStyleFor('abbr').textDecorationLine).toBe('underline');
});

test('the underline is dotted, as the browser draws it', () => {
  // The specific regression: `<abbr>` with an underline but no style would be
  // a solid rule, which reads as a link rather than as an abbreviation.
  expect(uaStyleFor('abbr').textDecorationStyle).toBe('dotted');
});

test('the elements that should be solid still are', () => {
  /*
   * A guard on the change rather than on the element: `textDecorationStyle` is
   * inherited-looking but is not inherited, and the risk when adding a style to
   * one member of the underlined set is applying it to the set. `<u>` and
   * `<ins>` must stay solid.
   */
  for (const tag of ['u', 'ins']) {
    expect(uaStyleFor(tag).textDecorationLine).toBe('underline');
    expect(uaStyleFor(tag).textDecorationStyle).toBeUndefined();
  }
});
