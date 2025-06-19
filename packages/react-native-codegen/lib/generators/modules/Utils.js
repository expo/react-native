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

const {unwrapNullable} = require('../../parsers/parsers-commons');
const invariant = require('invariant');
function createAliasResolver(aliasMap) {
  return aliasName => {
    const alias = aliasMap[aliasName];
    invariant(alias != null, `Unable to resolve type alias '${aliasName}'.`);
    return alias;
  };
}
function getModules(schema) {
  return Object.keys(schema.modules).reduce((modules, hasteModuleName) => {
    const module = schema.modules[hasteModuleName];
    if (module == null || module.type === 'Component') {
      return modules;
    }
    modules[hasteModuleName] = module;
    return modules;
  }, {});
}
function isDirectRecursiveMember(
  parentObjectAliasName,
  nullableTypeAnnotation,
) {
  const [typeAnnotation] = unwrapNullable(nullableTypeAnnotation);
  return (
    parentObjectAliasName !== undefined &&
    typeAnnotation.name === parentObjectAliasName
  );
}
function isArrayRecursiveMember(parentObjectAliasName, nullableTypeAnnotation) {
  var _typeAnnotation$eleme;
  const [typeAnnotation] = unwrapNullable(nullableTypeAnnotation);
  return (
    parentObjectAliasName !== undefined &&
    typeAnnotation.type === 'ArrayTypeAnnotation' &&
    ((_typeAnnotation$eleme = typeAnnotation.elementType) === null ||
    _typeAnnotation$eleme === void 0
      ? void 0
      : _typeAnnotation$eleme.name) === parentObjectAliasName
  );
}
module.exports = {
  createAliasResolver,
  getModules,
  isDirectRecursiveMember,
  isArrayRecursiveMember,
};
