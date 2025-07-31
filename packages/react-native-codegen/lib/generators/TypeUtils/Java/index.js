/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

const objectTypeForPrimitiveType = {
  boolean: 'Boolean',
  double: 'Double',
  float: 'Float',
  int: 'Integer',
};
function wrapOptional(type, isRequired) {
  var _objectTypeForPrimiti;
  return isRequired
    ? type
    : // $FlowFixMe[invalid-computed-prop]
      `@Nullable ${
        (_objectTypeForPrimiti = objectTypeForPrimitiveType[type]) !== null &&
        _objectTypeForPrimiti !== void 0
          ? _objectTypeForPrimiti
          : type
      }`;
}
module.exports = {
  wrapOptional,
};
