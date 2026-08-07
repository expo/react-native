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
  transformer: {
    // `.css` imports load as raw text for the stylesheet engine
    // (js/astryx/css); see css-transformer.js.
    babelTransformerPath: path.resolve(__dirname, 'css-transformer.js'),
  },
  resolver: {
    blockList: [/..\/react-native\/sdks\/hermes/],
    sourceExts: ['js', 'jsx', 'json', 'ts', 'tsx', 'css'],
    extraNodeModules: {
      'react-native': path.resolve(__dirname, '../react-native'),
    },
    // The vendored Astryx sources (js/astryx/vendor) import '@stylexjs/stylex'
    // verbatim; resolve it to the RN StyleX runtime so they run unmodified.
    resolveRequest: (context, moduleName, platform) => {
      // The Radix shim layer: vendored shadcn sources import
      // '@radix-ui/react-*' verbatim; each id resolves to the shim
      // implementing that package's public surface over the fork's machinery
      // (js/astryx/radix).
      // The vendored shadcn sources (js/shadcn/ui) import their world by the
      // upstream names; each resolves to the fork's implementation.
      if (moduleName === '@/lib/utils') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js', 'shadcn', 'lib', 'utils.js'),
        };
      }
      if (moduleName.startsWith('@/registry/default/ui/')) {
        const component = moduleName.slice('@/registry/default/ui/'.length);
        return {
          type: 'sourceFile',
          filePath: path.resolve(
            __dirname,
            'js',
            'shadcn',
            'ui',
            component + '.tsx',
          ),
        };
      }
      if (moduleName === 'class-variance-authority') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js', 'shadcn', 'lib', 'cva.js'),
        };
      }
      if (moduleName === 'lucide-react') {
        return {
          type: 'sourceFile',
          filePath: path.resolve(__dirname, 'js', 'shadcn', 'lib', 'lucide.js'),
        };
      }
      if (moduleName.startsWith('@radix-ui/')) {
        const radixName = moduleName.slice('@radix-ui/'.length);
        return {
          type: 'sourceFile',
          filePath: path.resolve(
            __dirname,
            'js',
            'astryx',
            'radix',
            'pkg',
            radixName + '.js',
          ),
        };
      }
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
