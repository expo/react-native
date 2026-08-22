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
 * `<abbr>` is underlined with dots, by the platform's own text stack.
 *
 * Found by putting the demos' markup in front of real Safari: the browser draws
 * a dotted underline under an abbreviation and we drew nothing, so the one
 * visual cue that says "this word has an expansion" was missing. The expected
 * value is not read off the spec — it is what `getComputedStyle` reports in
 * Safari 26 for `<abbr title>`: `text-decoration: underline dotted`.
 *
 * ## Why a decoration and not a border
 *
 * A 1px dotted bottom border would look identical on one line and wrong on
 * two: a border bounds the element's box, so a wrapped abbreviation would be
 * underlined once around the whole box instead of under each line. The text
 * decoration is drawn by CoreText on iOS (`NSUnderlineStyleSingle |
 * NSUnderlinePatternDot`) and by the dotted path in Android's decoration
 * drawing, and both follow the text through wrapping because they are part of
 * the run rather than around it.
 *
 * Asserted on the STYLE rather than on a rendered pixel: Fantom's deterministic
 * measurer reports geometry, not decoration, so a rendered-output assertion
 * here would pass whatever the value was — the same trap that made an earlier
 * colour test pass against broken code.
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
