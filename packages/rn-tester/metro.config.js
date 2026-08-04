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

/**
 * This cli config is needed for development purposes, e.g. for running
 * integration tests during local development or on CI services.
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  // Make Metro able to resolve required external dependencies
  watchFolders: [
    path.resolve(__dirname, '../../node_modules'),
    path.resolve(__dirname, '../asset-utils'),
    path.resolve(__dirname, '../community-cli-plugin'),
    path.resolve(__dirname, '../dev-middleware'),
    path.resolve(__dirname, '../new-app-screen'),
    path.resolve(__dirname, '../normalize-color'),
    path.resolve(__dirname, '../polyfills'),
    path.resolve(__dirname, '../react-native'),
    path.resolve(__dirname, '../virtualized-lists'),
    path.resolve(__dirname, '../react-native-popup-menu-android'),
    path.resolve(__dirname, '../react-native-test-library/apple'),
    path.resolve(__dirname, '../react-native-test-library/common'),
  ],
  resolver: {
    blockList: [/..\/react-native\/sdks\/hermes/],
    extraNodeModules: {
      'react-native': path.resolve(__dirname, '../react-native'),
    },
    // The vendored Astryx sources (js/astryx/vendor) import '@stylexjs/stylex'
    // verbatim; resolve it to the RN StyleX runtime so they run unmodified.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === '@stylexjs/stylex') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js/astryx/stylex-rn.js'),
        };
      }
      // The astryx directory compiles JSX against this runtime (see .babelrc)
      // so intrinsic elements can inherit CSS custom properties.
      if (
        moduleName === 'astryx-jsx/jsx-runtime' ||
        moduleName === 'astryx-jsx/jsx-dev-runtime'
      ) {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js/astryx/jsx-runtime.js'),
        };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
