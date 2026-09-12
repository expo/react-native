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
  /*
   * The native navigator is linked on iOS only, for now.
   *
   * react-native-screens 4.27 does not build against this fork's Android: its CMake declares
   * minSdkVersion 21 while ReactAndroid's prefab is built for 24, and react-native-safe-area-context
   * fails to compile its Kotlin. Neither is something this repository should paper over — they are
   * version-compatibility problems between a released library and a React Native built from source.
   *
   * Left autolinked on Android, they fail the whole Android build, including every screen that has
   * nothing to do with them. Excluded, Android builds as before and the native-stack screen simply
   * is not available there, which is the honest state rather than a hidden one.
   */
  dependencies: {
    'react-native-screens': {platforms: {android: null}},
    'react-native-safe-area-context': {platforms: {android: null}},
  },
};
