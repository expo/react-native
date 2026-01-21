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
const {
  unwrapNullable,
  wrapNullable,
} = require('../../../parsers/parsers-commons');
const {
  HeterogeneousUnionError,
  capitalize,
  parseValidUnionType,
} = require('../../Utils');
class StructCollector {
  constructor() {
    _defineProperty(this, '_structs', new Map());
  }
  process(structName, structContext, resolveAlias, nullableTypeAnnotation) {
    const [typeAnnotation, nullable] = unwrapNullable(nullableTypeAnnotation);
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
        try {
          const validUnionType = parseValidUnionType(typeAnnotation);
          switch (validUnionType) {
            case 'boolean':
              return wrapNullable(nullable, {
                type: 'BooleanTypeAnnotation',
              });
            case 'number':
              return wrapNullable(nullable, {
                type: 'NumberTypeAnnotation',
              });
            case 'object':
              // This isn't smart enough to actually know how to generate the
              // options on the native side. So we just treat it as an unknown object type
              return wrapNullable(nullable, {
                type: 'GenericObjectTypeAnnotation',
              });
            case 'string':
              return wrapNullable(nullable, {
                type: 'StringTypeAnnotation',
              });
            default:
              validUnionType;
              throw new Error(`Unsupported union member types`);
          }
        } catch (ex) {
          // TODO(T247151345): Implement proper heterogeneous union support.
          if (ex instanceof HeterogeneousUnionError) {
            return wrapNullable(nullable, typeAnnotation);
          }
          throw ex;
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
      return {
        ...property,
        typeAnnotation: this.process(
          propertyStructName,
          structContext,
          resolveAlias,
          property.typeAnnotation,
        ),
      };
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
