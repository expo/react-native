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
      // `settings.gradle.kts` includes `:packages:chat-demo:android:app`.
      sourceDir: '../../',
      manifestPath:
        'packages/chat-demo/android/app/src/main/AndroidManifest.xml',
      packageName: 'dev.expo.frontierdemo',
    },
  },
};
