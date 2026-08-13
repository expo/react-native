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

/**
 * Metro transformer wrapper: `.css` imports become their text, exactly like
 * a raw loader. The app hands the text to the stylesheet engine
 * (js/astryx/css) which parses and installs it; everything else delegates to
 * the standard React Native transformer.
 */

const upstreamTransformer = require('@react-native/metro-babel-transformer');

module.exports.transform = function transform(args) {
  if (args.filename.endsWith('.css')) {
    return upstreamTransformer.transform({
      ...args,
      src: 'module.exports = ' + JSON.stringify(args.src) + ';',
    });
  }
  return upstreamTransformer.transform(args);
};
