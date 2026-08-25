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
    // Astryx's one runtime dependency, `intl-messageformat`, ships static
    // class blocks. React Native's preset does not transform them, so the
    // bundler stops at `Static class blocks are not enabled` in a file nobody
    // here wrote. Enabling the transform is the whole fix; it is inert for
    // source that does not use the syntax.
    '@babel/plugin-transform-class-static-block',
  ],
  overrides: [
    {
      // The Astryx layer compiles JSX against its own runtime so intrinsic
      // elements inherit CSS custom properties (js/astryx/jsx-runtime.js;
      // Metro resolves the 'astryx-jsx' module id). An absolute path is
      // required — Babel matches `test` against the absolute filename.
      test: [
        path.join(__dirname, 'js', 'astryx'),
        path.join(__dirname, 'js', 'examples', 'Astryx'),
        path.join(__dirname, 'js', 'shadcn'),
      ],
      plugins: [
        [
          require('@babel/plugin-transform-react-jsx'),
          {runtime: 'automatic', importSource: 'astryx-jsx'},
        ],
      ],
    },
  ],
};
