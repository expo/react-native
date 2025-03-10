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
const _require = require('../../../../parsers/parsers-commons'),
  unwrapNullable = _require.unwrapNullable;
const _require2 = require('../../../TypeUtils/Cxx'),
  wrapCxxOptional = _require2.wrapOptional;
const _require3 = require('../../../TypeUtils/Objective-C'),
  wrapObjCOptional = _require3.wrapOptional;
const _require4 = require('../../../Utils'),
  capitalize = _require4.capitalize;
const _require5 = require('../Utils'),
  getNamespacedStructName = _require5.getNamespacedStructName,
  getSafePropertyName = _require5.getSafePropertyName;
const StructTemplate = ({
  hasteModuleName,
  structName,
  structProperties,
}) => `namespace JS {
  namespace ${hasteModuleName} {
    struct ${structName} {
      ${structProperties}

      ${structName}(NSDictionary *const v) : _v(v) {}
    private:
      NSDictionary *_v;
    };
  }
}

@interface RCTCxxConvert (${hasteModuleName}_${structName})
+ (RCTManagedPointer *)JS_${hasteModuleName}_${structName}:(id)json;
@end`;
const MethodTemplate = ({
  returnType,
  returnValue,
  hasteModuleName,
  structName,
  propertyName,
  safePropertyName,
}) => `inline ${returnType}JS::${hasteModuleName}::${structName}::${safePropertyName}() const
{
  id const p = _v[@"${propertyName}"];
  return ${returnValue};
}`;
function toObjCType(
  hasteModuleName,
  nullableTypeAnnotation,
  isOptional = false,
) {
  const _unwrapNullable = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable2 = _slicedToArray(_unwrapNullable, 2),
    typeAnnotation = _unwrapNullable2[0],
    nullable = _unwrapNullable2[1];
  const isRequired = !nullable && !isOptional;
  switch (typeAnnotation.type) {
    case 'ReservedTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'RootTag':
          return wrapCxxOptional('double', isRequired);
        default:
          typeAnnotation.name;
          throw new Error(`Unknown prop type, found: ${typeAnnotation.name}"`);
      }
    case 'StringTypeAnnotation':
      return 'NSString *';
    case 'StringLiteralTypeAnnotation':
      return 'NSString *';
    case 'StringLiteralUnionTypeAnnotation':
      return 'NSString *';
    case 'NumberTypeAnnotation':
      return wrapCxxOptional('double', isRequired);
    case 'NumberLiteralTypeAnnotation':
      return wrapCxxOptional('double', isRequired);
    case 'FloatTypeAnnotation':
      return wrapCxxOptional('double', isRequired);
    case 'Int32TypeAnnotation':
      return wrapCxxOptional('double', isRequired);
    case 'DoubleTypeAnnotation':
      return wrapCxxOptional('double', isRequired);
    case 'BooleanTypeAnnotation':
      return wrapCxxOptional('bool', isRequired);
    case 'EnumDeclaration':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return wrapCxxOptional('double', isRequired);
        case 'StringTypeAnnotation':
          return 'NSString *';
        default:
          throw new Error(
            `Couldn't convert enum into ObjC type: ${typeAnnotation.type}"`,
          );
      }
    case 'GenericObjectTypeAnnotation':
      return wrapObjCOptional('id<NSObject>', isRequired);
    case 'ArrayTypeAnnotation':
      if (typeAnnotation.elementType.type === 'AnyTypeAnnotation') {
        return wrapObjCOptional('id<NSObject>', isRequired);
      }
      return wrapCxxOptional(
        `facebook::react::LazyVector<${toObjCType(
          hasteModuleName,
          typeAnnotation.elementType,
        )}>`,
        isRequired,
      );
    case 'TypeAliasTypeAnnotation':
      const structName = capitalize(typeAnnotation.name);
      const namespacedStructName = getNamespacedStructName(
        hasteModuleName,
        structName,
      );
      return wrapCxxOptional(namespacedStructName, isRequired);
    default:
      typeAnnotation.type;
      throw new Error(
        `Couldn't convert into ObjC type: ${typeAnnotation.type}"`,
      );
  }
}
function toObjCValue(
  hasteModuleName,
  nullableTypeAnnotation,
  value,
  depth,
  isOptional = false,
) {
  const _unwrapNullable3 = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable4 = _slicedToArray(_unwrapNullable3, 2),
    typeAnnotation = _unwrapNullable4[0],
    nullable = _unwrapNullable4[1];
  const isRequired = !nullable && !isOptional;
  const RCTBridgingTo = (type, arg) => {
    const args = [value, arg].filter(Boolean).join(', ');
    return isRequired
      ? `RCTBridgingTo${type}(${args})`
      : `RCTBridgingToOptional${type}(${args})`;
  };
  switch (typeAnnotation.type) {
    case 'ReservedTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'RootTag':
          return RCTBridgingTo('Double');
        default:
          typeAnnotation.name;
          throw new Error(
            `Couldn't convert into ObjC type: ${typeAnnotation.type}"`,
          );
      }
    case 'StringTypeAnnotation':
      return RCTBridgingTo('String');
    case 'StringLiteralTypeAnnotation':
      return RCTBridgingTo('String');
    case 'StringLiteralUnionTypeAnnotation':
      return RCTBridgingTo('String');
    case 'NumberTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'NumberLiteralTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'FloatTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'Int32TypeAnnotation':
      return RCTBridgingTo('Double');
    case 'DoubleTypeAnnotation':
      return RCTBridgingTo('Double');
    case 'BooleanTypeAnnotation':
      return RCTBridgingTo('Bool');
    case 'EnumDeclaration':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return RCTBridgingTo('Double');
        case 'StringTypeAnnotation':
          return RCTBridgingTo('String');
        default:
          throw new Error(
            `Couldn't convert enum into ObjC value: ${typeAnnotation.type}"`,
          );
      }
    case 'GenericObjectTypeAnnotation':
      return value;
    case 'ArrayTypeAnnotation':
      const elementType = typeAnnotation.elementType;
      if (elementType.type === 'AnyTypeAnnotation') {
        return value;
      }
      const localVarName = `itemValue_${depth}`;
      const elementObjCType = toObjCType(hasteModuleName, elementType);
      const elementObjCValue = toObjCValue(
        hasteModuleName,
        elementType,
        localVarName,
        depth + 1,
      );
      return RCTBridgingTo(
        'Vec',
        `^${elementObjCType}(id ${localVarName}) { return ${elementObjCValue}; }`,
      );
    case 'TypeAliasTypeAnnotation':
      const structName = capitalize(typeAnnotation.name);
      const namespacedStructName = getNamespacedStructName(
        hasteModuleName,
        structName,
      );
      return !isRequired
        ? `(${value} == nil ? std::nullopt : std::make_optional(${namespacedStructName}(${value})))`
        : `${namespacedStructName}(${value})`;
    default:
      typeAnnotation.type;
      throw new Error(
        `Couldn't convert into ObjC value: ${typeAnnotation.type}"`,
      );
  }
}
function serializeRegularStruct(hasteModuleName, struct) {
  const declaration = StructTemplate({
    hasteModuleName: hasteModuleName,
    structName: struct.name,
    structProperties: struct.properties
      .map(property => {
        const typeAnnotation = property.typeAnnotation,
          optional = property.optional;
        const safePropName = getSafePropertyName(property);
        const returnType = toObjCType(
          hasteModuleName,
          typeAnnotation,
          optional,
        );
        const padding = ' '.repeat(returnType.endsWith('*') ? 0 : 1);
        return `${returnType}${padding}${safePropName}() const;`;
      })
      .join('\n      '),
  });

  // $FlowFixMe[missing-type-arg]
  const methods = struct.properties
    .map(property => {
      const typeAnnotation = property.typeAnnotation,
        optional = property.optional,
        propName = property.name;
      const safePropertyName = getSafePropertyName(property);
      const returnType = toObjCType(hasteModuleName, typeAnnotation, optional);
      const returnValue = toObjCValue(
        hasteModuleName,
        typeAnnotation,
        'p',
        0,
        optional,
      );
      const padding = ' '.repeat(returnType.endsWith('*') ? 0 : 1);
      return MethodTemplate({
        hasteModuleName,
        structName: struct.name,
        returnType: returnType + padding,
        returnValue: returnValue,
        propertyName: propName,
        safePropertyName,
      });
    })
    .join('\n');
  return {
    methods,
    declaration,
  };
}
module.exports = {
  serializeRegularStruct,
};
