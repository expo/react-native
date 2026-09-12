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
 * Without this the CLI reports `platforms: []` for this package, and a Release bundle fails
 * with `Invalid platform "ios" selected` — AFTER compiling everything, so it reads like a
 * bundler bug rather than a missing config.
 *
 * The platforms are registered by React Native's OWN config, which an ordinary app picks up
 * through its `react-native` dependency. Here `react-native` is a sibling package rather than
 * an installed one, so the config is spread in explicitly, exactly as `rn-tester` does.
 */
const config = require('../react-native/react-native.config.js');

module.exports = {
  ...config,
  reactNativePath: '../react-native',
  project: {
    ios: {sourceDir: 'ios'},
    android: {
      // The Gradle build is rooted at the repository, not at this package — see
      // `settings.gradle.kts`, which owns `:packages:chat-demo:android:app`.
      sourceDir: '../../',
      manifestPath:
        'packages/chat-demo/android/app/src/main/AndroidManifest.xml',
      packageName: 'dev.expo.frontierdemo',
    },
  },
};
