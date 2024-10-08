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

function _slicedToArray(r, e) {
  return (
    _arrayWithHoles(r) ||
    _iterableToArrayLimit(r, e) ||
    _unsupportedIterableToArray(r, e) ||
    _nonIterableRest()
  );
}
function _nonIterableRest() {
  throw new TypeError(
    'Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.',
  );
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ('string' == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return (
      'Object' === t && r.constructor && (t = r.constructor.name),
      'Map' === t || 'Set' === t
        ? Array.from(r)
        : 'Arguments' === t ||
          /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)
        ? _arrayLikeToArray(r, a)
        : void 0
    );
  }
}
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _iterableToArrayLimit(r, l) {
  var t =
    null == r
      ? null
      : ('undefined' != typeof Symbol && r[Symbol.iterator]) || r['@@iterator'];
  if (null != t) {
    var e,
      n,
      i,
      u,
      a = [],
      f = !0,
      o = !1;
    try {
      if (((i = (t = t.call(r)).next), 0 === l)) {
        if (Object(t) !== t) return;
        f = !1;
      } else
        for (
          ;
          !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l);
          f = !0
        );
    } catch (r) {
      (o = !0), (n = r);
    } finally {
      try {
        if (!f && null != t.return && ((u = t.return()), Object(u) !== u))
          return;
      } finally {
        if (o) throw n;
      }
    }
    return a;
  }
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
const _require = require('../../parsers/parsers-commons'),
  unwrapNullable = _require.unwrapNullable;
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
  const _unwrapNullable = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable2 = _slicedToArray(_unwrapNullable, 1),
    typeAnnotation = _unwrapNullable2[0];
  return (
    parentObjectAliasName !== undefined &&
    typeAnnotation.name === parentObjectAliasName
  );
}
function isArrayRecursiveMember(parentObjectAliasName, nullableTypeAnnotation) {
  var _typeAnnotation$eleme;
  const _unwrapNullable3 = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable4 = _slicedToArray(_unwrapNullable3, 1),
    typeAnnotation = _unwrapNullable4[0];
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
