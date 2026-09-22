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
 * Served from the repository root rather than from this folder.
 *
 * The app asks for `packages/chat-demo/index`, and it imports the elements
 * under test out of `packages/expo-intrinsics` — both are inside the repo and
 * neither is inside this package, so the root is the only project root that
 * covers them. react-native resolves through the root `node_modules`, where it
 * is symlinked to `packages/react-native`.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  projectRoot: repoRoot,
  watchFolders: [repoRoot],
};

module.exports = mergeConfig(getDefaultConfig(repoRoot), config);
