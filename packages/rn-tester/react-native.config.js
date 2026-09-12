/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

module.exports = {
  reactNativePath: '../react-native',
  project: {
    ios: {
      sourceDir: '.',
    },
    android: {
      sourceDir: '../../',
      // To remove once the CLI fix for manifestPath search path is landed.
      manifestPath:
        'packages/rn-tester/android/app/src/main/AndroidManifest.xml',
      packageName: 'com.facebook.react.uiapp',
    },
  },
  // The native navigator is linked on iOS only: react-native-screens 4.27 declares minSdkVersion 21
  // against a prefab built for 24, and react-native-safe-area-context fails to compile its Kotlin, so
  // autolinked they fail the whole Android build
  dependencies: {
    'react-native-screens': {platforms: {android: null}},
    'react-native-safe-area-context': {platforms: {android: null}},
  },
};
