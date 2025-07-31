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
const {capitalize} = require('../../Utils');
class PojoCollector {
  constructor() {
    _defineProperty(this, '_pojos', new Map());
  }
  process(namespace, pojoName, typeAnnotation) {
    switch (typeAnnotation.type) {
      case 'ObjectTypeAnnotation': {
        this._insertPojo(namespace, pojoName, typeAnnotation);
        return {
          type: 'PojoTypeAliasTypeAnnotation',
          name: pojoName,
        };
      }
      case 'ArrayTypeAnnotation': {
        const arrayTypeAnnotation = typeAnnotation;
        const elementType = arrayTypeAnnotation.elementType;
        const pojoElementType = (() => {
          switch (elementType.type) {
            case 'ObjectTypeAnnotation': {
              this._insertPojo(namespace, `${pojoName}Element`, elementType);
              return {
                type: 'PojoTypeAliasTypeAnnotation',
                name: `${pojoName}Element`,
              };
            }
            case 'ArrayTypeAnnotation': {
              const {elementType: objectTypeAnnotation} = elementType;
              this._insertPojo(
                namespace,
                `${pojoName}ElementElement`,
                objectTypeAnnotation,
              );
              return {
                type: 'ArrayTypeAnnotation',
                elementType: {
                  type: 'PojoTypeAliasTypeAnnotation',
                  name: `${pojoName}ElementElement`,
                },
              };
            }
            default: {
              return elementType;
            }
          }
        })();

        /* $FlowFixMe[incompatible-return] Natural Inference rollout. See
         * https://fburl.com/workplace/6291gfvu */
        return {
          type: 'ArrayTypeAnnotation',
          elementType: pojoElementType,
        };
      }
      default:
        return typeAnnotation;
    }
  }
  _insertPojo(namespace, pojoName, objectTypeAnnotation) {
    const properties = objectTypeAnnotation.properties.map(property => {
      const propertyPojoName = pojoName + capitalize(property.name);
      return {
        ...property,
        typeAnnotation: this.process(
          namespace,
          propertyPojoName,
          property.typeAnnotation,
        ),
      };
    });
    this._pojos.set(pojoName, {
      name: pojoName,
      namespace,
      properties,
    });
  }
  getAllPojos() {
    return [...this._pojos.values()];
  }
}
module.exports = PojoCollector;
