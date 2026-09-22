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

const {getDefaultConfig} = require('@react-native/metro-config');
const {mergeConfig} = require('metro-config');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

/**
 * The project root is the repository root: `AppDelegate.mm` and
 * `MainApplication.kt` request the bundle as `packages/chat-demo/index`, and
 * the app imports from `packages/expo-intrinsics`.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  projectRoot: repoRoot,
  watchFolders: [repoRoot],
};

module.exports = mergeConfig(getDefaultConfig(repoRoot), config);
