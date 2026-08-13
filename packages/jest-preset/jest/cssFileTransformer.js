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
 * Jest counterpart of rn-tester's Metro css transformer: a `.css` import is
 * its raw text.
 */

module.exports = {
  process(src /*: string */) /*: {code: string} */ {
    return {code: 'module.exports = ' + JSON.stringify(src) + ';'};
  },
};
