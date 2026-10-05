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
 * An inline element's accessibility attributes reach the shared model on every platform.
 *
 * Which parts of a sentence are separate screen-reader stops is decided once, in C++
 * (`InlineAccessibilityContent`), from the element's props. A prop the view config does not list
 * never gets there, and the platform base configs each list only their own half of the
 * accessibility attributes. So the same `<span accessibilityLiveRegion="polite">` was a stop of its
 * own on Android and folded into the surrounding text on iOS, and a `<span accessibilityLanguage>`
 * the other way round. The inline view configs declare both halves, which this pins.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

import {get as getViewConfig} from 'react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry';

const SEMANTIC_ATTRIBUTES = [
  'accessibilityElementsHidden',
  'accessibilityLanguage',
  'accessibilityLiveRegion',
  'importantForAccessibility',
];

for (const tag of ['span', 'b', 'strong']) {
  for (const attribute of SEMANTIC_ATTRIBUTES) {
    test(`<${tag}> declares ${attribute}`, () => {
      expect(getViewConfig(tag).validAttributes[attribute]).toBe(true);
    });
  }
}
