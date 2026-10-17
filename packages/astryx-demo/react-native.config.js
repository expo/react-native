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
    ios: {sourceDir: 'ios'},
    android: {
      // The Gradle build is rooted at the repository: the root
      // `settings.gradle.kts` includes `:packages:astryx-demo:android:app`.
      sourceDir: '../../',
      manifestPath:
        'packages/astryx-demo/android/app/src/main/AndroidManifest.xml',
      packageName: 'dev.expo.astryxdemo',
    },
  },
  dependencies: {
    // The Android app is a plain shell (index.android.js): Expo Router, the
    // Expo modules it runs on and its native stack stay iOS-only, so none of
    // them is built there
    'react-native-screens': {platforms: {android: null}},
    'react-native-safe-area-context': {platforms: {android: null}},
    expo: {platforms: {android: null}},
    'expo-modules-core': {platforms: {android: null}},
    'expo-router': {platforms: {android: null}},
    'expo-image': {platforms: {android: null}},
    'expo-constants': {platforms: {android: null}},
    'expo-linking': {platforms: {android: null}},
    'expo-glass-effect': {platforms: {android: null}},
    'expo-modules-autolinking': {platforms: {android: null}},
  },
};
