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

/*
 * React Native's config registers the iOS and Android platforms. An app
 * normally gets it from its installed `react-native` dependency; here
 * `react-native` is a sibling package, so it is spread in (as `rn-tester`
 * does). Without it a Release bundle fails with `Invalid platform "ios"
 * selected`.
 */
const config = require('../react-native/react-native.config.js');

module.exports = {
  ...config,
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
