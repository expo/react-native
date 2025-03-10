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

function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r &&
      (o = o.filter(function (r) {
        return Object.getOwnPropertyDescriptor(e, r).enumerable;
      })),
      t.push.apply(t, o);
  }
  return t;
}
function _objectSpread(e) {
  for (var r = 1; r < arguments.length; r++) {
    var t = null != arguments[r] ? arguments[r] : {};
    r % 2
      ? ownKeys(Object(t), !0).forEach(function (r) {
          _defineProperty(e, r, t[r]);
        })
      : Object.getOwnPropertyDescriptors
      ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t))
      : ownKeys(Object(t)).forEach(function (r) {
          Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
        });
  }
  return e;
}
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
function _defineProperty(e, r, t) {
  return (
    (r = _toPropertyKey(r)) in e
      ? Object.defineProperty(e, r, {
          value: t,
          enumerable: !0,
          configurable: !0,
          writable: !0,
        })
      : (e[r] = t),
    e
  );
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, 'string');
  return 'symbol' == typeof i ? i : i + '';
}
function _toPrimitive(t, r) {
  if ('object' != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || 'default');
    if ('object' != typeof i) return i;
    throw new TypeError('@@toPrimitive must return a primitive value.');
  }
  return ('string' === r ? String : Number)(t);
}
const _require = require('../../../parsers/parsers-commons'),
  unwrapNullable = _require.unwrapNullable,
  wrapNullable = _require.wrapNullable;
const _require2 = require('../../Utils'),
  capitalize = _require2.capitalize;
class StructCollector {
  constructor() {
    _defineProperty(this, '_structs', new Map());
  }
  process(structName, structContext, resolveAlias, nullableTypeAnnotation) {
    const _unwrapNullable = unwrapNullable(nullableTypeAnnotation),
      _unwrapNullable2 = _slicedToArray(_unwrapNullable, 2),
      typeAnnotation = _unwrapNullable2[0],
      nullable = _unwrapNullable2[1];
    switch (typeAnnotation.type) {
      case 'ObjectTypeAnnotation': {
        this._insertStruct(
          structName,
          structContext,
          resolveAlias,
          typeAnnotation,
        );
        return wrapNullable(nullable, {
          type: 'TypeAliasTypeAnnotation',
          name: structName,
        });
      }
      case 'ArrayTypeAnnotation': {
        if (typeAnnotation.elementType.type === 'AnyTypeAnnotation') {
          return wrapNullable(nullable, {
            type: 'ArrayTypeAnnotation',
            elementType: {
              type: 'AnyTypeAnnotation',
            },
          });
        }
        return wrapNullable(nullable, {
          type: 'ArrayTypeAnnotation',
          elementType: this.process(
            structName + 'Element',
            structContext,
            resolveAlias,
            typeAnnotation.elementType,
          ),
        });
      }
      case 'TypeAliasTypeAnnotation': {
        this._insertAlias(typeAnnotation.name, structContext, resolveAlias);
        return wrapNullable(nullable, typeAnnotation);
      }
      case 'EnumDeclaration':
        return wrapNullable(nullable, typeAnnotation);
      case 'MixedTypeAnnotation':
        throw new Error('Mixed types are unsupported in structs');
      case 'UnionTypeAnnotation':
        switch (typeAnnotation.memberType) {
          case 'StringTypeAnnotation':
            return wrapNullable(nullable, {
              type: 'StringTypeAnnotation',
            });
          case 'NumberTypeAnnotation':
            return wrapNullable(nullable, {
              type: 'NumberTypeAnnotation',
            });
          case 'ObjectTypeAnnotation':
            // This isn't smart enough to actually know how to generate the
            // options on the native side. So we just treat it as an unknown object type
            return wrapNullable(nullable, {
              type: 'GenericObjectTypeAnnotation',
            });
          default:
            typeAnnotation.memberType;
            throw new Error(
              'Union types are unsupported in structs' +
                JSON.stringify(typeAnnotation),
            );
        }
      default: {
        return wrapNullable(nullable, typeAnnotation);
      }
    }
  }
  _insertAlias(aliasName, structContext, resolveAlias) {
    const usedStruct = this._structs.get(aliasName);
    if (usedStruct == null) {
      this._insertStruct(
        aliasName,
        structContext,
        resolveAlias,
        resolveAlias(aliasName),
      );
    } else if (usedStruct.context !== structContext) {
      throw new Error(
        `Tried to use alias '${aliasName}' in a getConstants() return type and inside a regular struct.`,
      );
    }
  }
  _insertStruct(structName, structContext, resolveAlias, objectTypeAnnotation) {
    // $FlowFixMe[missing-type-arg]
    const properties = objectTypeAnnotation.properties.map(property => {
      const propertyStructName = structName + capitalize(property.name);
      return _objectSpread(
        _objectSpread({}, property),
        {},
        {
          typeAnnotation: this.process(
            propertyStructName,
            structContext,
            resolveAlias,
            property.typeAnnotation,
          ),
        },
      );
    });
    switch (structContext) {
      case 'REGULAR':
        this._structs.set(structName, {
          name: structName,
          context: 'REGULAR',
          properties: properties,
        });
        break;
      case 'CONSTANTS':
        this._structs.set(structName, {
          name: structName,
          context: 'CONSTANTS',
          properties: properties,
        });
        break;
      default:
        structContext;
        throw new Error(`Detected an invalid struct context: ${structContext}`);
    }
  }
  getAllStructs() {
    return [...this._structs.values()];
  }
  getStruct(name) {
    return this._structs.get(name);
  }
}
module.exports = {
  StructCollector,
};
