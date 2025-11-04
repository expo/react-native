/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

'use strict';

const hermesParser = require('hermes-parser');
function parseFlowAndThrowErrors(code, options = {}) {
  let ast;
  try {
    ast = hermesParser.parse(code, {
      // Produce an ESTree-compliant AST
      babel: false,
      // Parse Flow without a pragma
      flow: 'all',
      reactRuntimeTarget: '19',
      ...(options.filename != null
        ? {
            sourceFilename: options.filename,
          }
        : {}),
    });
  } catch (e) {
    if (options.filename != null) {
      e.message = `Syntax error in ${options.filename}: ${e.message}`;
    }
    throw e;
  }
  return ast;
}
module.exports = {
  parseFlowAndThrowErrors,
};
