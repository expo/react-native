/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import type {
  BabelTransformer,
  BabelTransformerArgs,
} from 'metro-babel-transformer';

import MetroBabelTransformer from '@react-native/metro-babel-transformer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/*
 * RNTester's Babel config and `.css` loading, for the RNTester code Fantom's
 * tests render: Babel reads a package's own config only under the project
 * root, which here is the repository's, so the overrides RNTester's config
 * gives its directories (the Astryx layer compiles JSX against its own
 * runtime) are applied here, as RNTester's Metro applies them
 */
const RN_TESTER_BABEL_CONFIG_PATH = require.resolve(
  '../../../packages/rn-tester/.babelrc.js',
);
const RN_TESTER_CSS_TRANSFORMER_PATH = require.resolve(
  '../../../packages/rn-tester/css-transformer.js',
);
// $FlowExpectedError[unsupported-syntax]
const rnTesterBabelConfig = require(RN_TESTER_BABEL_CONFIG_PATH);
// $FlowExpectedError[unsupported-syntax]
const {cssAsModule} = require(RN_TESTER_CSS_TRANSFORMER_PATH);

function rnTesterOverridePlugins(filename: string): Array<unknown> {
  const plugins: Array<unknown> = [];
  for (const override of rnTesterBabelConfig.overrides ?? []) {
    if (
      override.test.some((directory: string) =>
        filename.startsWith(directory + path.sep),
      )
    ) {
      plugins.push(...override.plugins);
    }
  }
  return plugins;
}

const transform: BabelTransformer['transform'] = (
  args: BabelTransformerArgs,
) => {
  const filename = path.resolve(args.options.projectRoot, args.filename);
  const processedArgs = {
    ...args,
    src: filename.endsWith('.css') ? cssAsModule(args.src) : args.src,
    plugins: [
      ...(args.plugins ?? []),
      ...rnTesterOverridePlugins(filename),
      // $FlowExpectedError[untyped-import]
      require('./babel-plugins/inject-debugger-statements-in-tests'),
      ...(args.options.customTransformOptions?.collectCoverage === 'true'
        ? [
            [
              require.resolve('babel-plugin-istanbul'),
              {
                include: [
                  '**/packages/react-native/Libraries/**/*.js',
                  '**/packages/react-native/src/**/*.js',
                  '**/packages/virtualized-lists/**/*.js',
                ],
                exclude: [
                  '**/packages/react-native/Libraries/Renderer/**',
                  '**/__tests__/**',
                ],
              },
            ],
          ]
        : []),
    ],
  };
  return MetroBabelTransformer.transform(processedArgs);
};

module.exports = {
  ...MetroBabelTransformer,
  transform,
  getCacheKey(): string {
    const key = crypto.createHash('md5');
    const cacheKeyParts = [
      MetroBabelTransformer.getCacheKey?.() ?? '',
      fs.readFileSync(__filename),
      fs.readFileSync(
        require.resolve('./babel-plugins/inject-debugger-statements-in-tests'),
      ),
      fs.readFileSync(RN_TESTER_BABEL_CONFIG_PATH),
      fs.readFileSync(RN_TESTER_CSS_TRANSFORMER_PATH),
    ];
    cacheKeyParts.forEach(part => key.update(part));
    return key.digest('hex');
  },
};
