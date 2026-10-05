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

// A `.css` import becomes its text, like a raw loader, for js/astryx/css to
// parse; everything else goes to the standard transformer

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
