/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 *
 */

'use strict';

function wrapComponentSchema({
  filename,
  componentName,
  extendsProps,
  events,
  props,
  options,
  commands,
}) {
  return {
    modules: {
      [filename]: {
        type: 'Component',
        components: {
          [componentName]: {
            ...(options || {}),
            extendsProps,
            events,
            props,
            commands,
          },
        },
      },
    },
  };
}
module.exports = {
  wrapComponentSchema,
};
