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
 * `<code>`, `<kbd>`, `<samp>` and `<pre>` name a font the platform HAS.
 *
 * CSS's generic families are not font names, and React Native resolves
 * `fontFamily` against real faces. Android accepts `'monospace'` as an alias,
 * so the literal worked there and silently fell back to the system font on
 * iOS — a declaration that is correct on one platform and inert on the other,
 * which no screenshot of Android would ever reveal.
 *
 * Asserted by NAME rather than "some font is set", because the failure mode is
 * precisely a name the platform does not recognise.
 */

import {uaStyleFor} from '../src/uaStyles';
import {Platform} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

const EXPECTED = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

test('the monospace elements ask for a face this platform has', () => {
  for (const tag of ['code', 'kbd', 'samp', 'pre']) {
    expect(uaStyleFor(tag).fontFamily).toBe(EXPECTED);
  }
});

test('the generic CSS name is never handed to iOS', () => {
  // The specific regression: 'monospace' is not a face on iOS, so shipping it
  // there means the element renders in the system font with no error at all.
  if (Platform.OS === 'ios') {
    for (const tag of ['code', 'kbd', 'samp', 'pre']) {
      expect(uaStyleFor(tag).fontFamily).not.toBe('monospace');
    }
  }
});
