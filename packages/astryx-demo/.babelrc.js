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

const path = require('node:path');

module.exports = {
  presets: [
    ['module:@react-native/babel-preset', {disableDeepImportWarnings: true}],
  ],
  plugins: [
    'babel-plugin-transform-flow-enums',
    // Astryx's dependency `intl-messageformat` ships static class blocks, which
    // React Native's preset does not transform
    '@babel/plugin-transform-class-static-block',
  ],
  overrides: [
    {
      // The Astryx layer, the vendored templates and this app's screens compile
      // JSX against the runtime that renders intrinsic elements for the
      // renderer's style engine (packages/rn-tester/js/astryx/jsx-runtime.js;
      // Metro resolves the 'astryx-jsx' module id). Absolute paths: Babel matches `test`
      // against the absolute filename.
      test: [
        path.join(__dirname, '..', 'rn-tester', 'js', 'astryx'),
        path.join(__dirname, 'app'),
        path.join(__dirname, 'templates'),
        path.join(__dirname, 'src'),
      ],
      plugins: [
        [
          require('@babel/plugin-transform-react-jsx'),
          {
            runtime: 'automatic',
            importSource: 'astryx-jsx',
            // The catalog's own elements are namespaced tags (`<native:scroll>`)
            throwIfNamespace: false,
          },
        ],
      ],
    },
  ],
};
