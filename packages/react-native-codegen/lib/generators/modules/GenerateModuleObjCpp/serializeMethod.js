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
const _require = require('../../../parsers/parsers-commons'),
  unwrapNullable = _require.unwrapNullable,
  wrapNullable = _require.wrapNullable;
const _require2 = require('../../TypeUtils/Objective-C'),
  wrapOptional = _require2.wrapOptional;
const _require3 = require('../../Utils'),
  capitalize = _require3.capitalize;
const _require4 = require('./Utils'),
  getNamespacedStructName = _require4.getNamespacedStructName;
const invariant = require('invariant');
const ProtocolMethodTemplate = ({returnObjCType, methodName, params}) =>
  `- (${returnObjCType})${methodName}${params};`;
function serializeMethod(
  hasteModuleName,
  property,
  structCollector,
  resolveAlias,
) {
  const methodName = property.name,
    nullableTypeAnnotation = property.typeAnnotation;
  const _unwrapNullable = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable2 = _slicedToArray(_unwrapNullable, 1),
    propertyTypeAnnotation = _unwrapNullable2[0];
  const params = propertyTypeAnnotation.params;
  if (methodName === 'getConstants') {
    return serializeConstantsProtocolMethods(
      hasteModuleName,
      property,
      structCollector,
      resolveAlias,
    );
  }
  const methodParams = [];
  const structParamRecords = [];
  params.forEach((param, index) => {
    const structName = getParamStructName(methodName, param);
    const _getParamObjCType = getParamObjCType(
        hasteModuleName,
        methodName,
        param,
        structName,
        structCollector,
        resolveAlias,
      ),
      objCType = _getParamObjCType.objCType,
      isStruct = _getParamObjCType.isStruct;
    methodParams.push({
      paramName: param.name,
      objCType,
    });
    if (isStruct) {
      structParamRecords.push({
        paramIndex: index,
        structName,
      });
    }
  });

  // Unwrap returnTypeAnnotation, so we check if the return type is Promise
  // TODO(T76719514): Disallow nullable PromiseTypeAnnotations
  const _unwrapNullable3 = unwrapNullable(
      propertyTypeAnnotation.returnTypeAnnotation,
    ),
    _unwrapNullable4 = _slicedToArray(_unwrapNullable3, 1),
    returnTypeAnnotation = _unwrapNullable4[0];
  if (returnTypeAnnotation.type === 'PromiseTypeAnnotation') {
    methodParams.push(
      {
        paramName: 'resolve',
        objCType: 'RCTPromiseResolveBlock',
      },
      {
        paramName: 'reject',
        objCType: 'RCTPromiseRejectBlock',
      },
    );
  }

  /**
   * Build Protocol Method
   **/
  const returnObjCType = getReturnObjCType(
    methodName,
    propertyTypeAnnotation.returnTypeAnnotation,
  );
  const paddingMax = `- (${returnObjCType})${methodName}`.length;
  const objCParams = methodParams.reduce(
    ($objCParams, {objCType, paramName}, i) => {
      const rhs = `(${objCType})${paramName}`;
      const padding = ' '.repeat(Math.max(0, paddingMax - paramName.length));
      return i === 0
        ? `:${rhs}`
        : `${$objCParams}\n${padding}${paramName}:${rhs}`;
    },
    '',
  );
  const protocolMethod = ProtocolMethodTemplate({
    methodName,
    returnObjCType,
    params: objCParams,
  });

  /**
   * Build ObjC Selector
   */
  // $FlowFixMe[missing-type-arg]
  const selector = methodParams
    .map(({paramName}) => paramName)
    .reduce(($selector, paramName, i) => {
      return i === 0 ? `${$selector}:` : `${$selector}${paramName}:`;
    }, methodName);

  /**
   * Build JS Return type
   */
  const returnJSType = getReturnJSType(methodName, returnTypeAnnotation);
  return [
    {
      methodName,
      protocolMethod,
      selector: `@selector(${selector})`,
      structParamRecords,
      returnJSType,
      argCount: params.length,
    },
  ];
}
function getParamStructName(methodName, param) {
  const _unwrapNullable5 = unwrapNullable(param.typeAnnotation),
    _unwrapNullable6 = _slicedToArray(_unwrapNullable5, 1),
    typeAnnotation = _unwrapNullable6[0];
  if (typeAnnotation.type === 'TypeAliasTypeAnnotation') {
    return typeAnnotation.name;
  }
  return `Spec${capitalize(methodName)}${capitalize(param.name)}`;
}
function getParamObjCType(
  hasteModuleName,
  methodName,
  param,
  structName,
  structCollector,
  resolveAlias,
) {
  const paramName = param.name,
    nullableTypeAnnotation = param.typeAnnotation;
  const _unwrapNullable7 = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable8 = _slicedToArray(_unwrapNullable7, 2),
    typeAnnotation = _unwrapNullable8[0],
    nullable = _unwrapNullable8[1];
  const isRequired = !param.optional && !nullable;
  const isStruct = objCType => ({
    isStruct: true,
    objCType,
  });
  const notStruct = objCType => ({
    isStruct: false,
    objCType,
  });

  // Handle types that can only be in parameters
  switch (typeAnnotation.type) {
    case 'FunctionTypeAnnotation': {
      return notStruct('RCTResponseSenderBlock');
    }
    case 'ArrayTypeAnnotation': {
      /**
       * Array in params always codegen NSArray *
       *
       * TODO(T73933406): Support codegen for Arrays of structs and primitives
       *
       * For example:
       *   Array<number> => NSArray<NSNumber *>
       *   type Animal = {};
       *   Array<Animal> => NSArray<JS::NativeSampleTurboModule::Animal *>, etc.
       */
      return notStruct(wrapOptional('NSArray *', !nullable));
    }
  }
  const _unwrapNullable9 = unwrapNullable(
      structCollector.process(
        structName,
        'REGULAR',
        resolveAlias,
        wrapNullable(nullable, typeAnnotation),
      ),
    ),
    _unwrapNullable10 = _slicedToArray(_unwrapNullable9, 1),
    structTypeAnnotation = _unwrapNullable10[0];
  invariant(
    structTypeAnnotation.type !== 'ArrayTypeAnnotation',
    'ArrayTypeAnnotations should have been processed earlier',
  );
  switch (structTypeAnnotation.type) {
    case 'TypeAliasTypeAnnotation': {
      /**
       * TODO(T73943261): Support nullable object literals and aliases?
       */
      return isStruct(
        getNamespacedStructName(hasteModuleName, structTypeAnnotation.name) +
          ' &',
      );
    }
    case 'ReservedTypeAnnotation':
      switch (structTypeAnnotation.name) {
        case 'RootTag':
          return notStruct(isRequired ? 'double' : 'NSNumber *');
        default:
          structTypeAnnotation.name;
          throw new Error(
            `Unsupported type for param "${paramName}" in ${methodName}. Found: ${structTypeAnnotation.type}`,
          );
      }
    case 'StringTypeAnnotation':
      return notStruct(wrapOptional('NSString *', !nullable));
    case 'StringLiteralTypeAnnotation':
      return notStruct(wrapOptional('NSString *', !nullable));
    case 'StringLiteralUnionTypeAnnotation':
      return notStruct(wrapOptional('NSString *', !nullable));
    case 'NumberTypeAnnotation':
      return notStruct(isRequired ? 'double' : 'NSNumber *');
    case 'NumberLiteralTypeAnnotation':
      return notStruct(isRequired ? 'double' : 'NSNumber *');
    case 'FloatTypeAnnotation':
      return notStruct(isRequired ? 'float' : 'NSNumber *');
    case 'DoubleTypeAnnotation':
      return notStruct(isRequired ? 'double' : 'NSNumber *');
    case 'Int32TypeAnnotation':
      return notStruct(isRequired ? 'NSInteger' : 'NSNumber *');
    case 'BooleanTypeAnnotation':
      return notStruct(isRequired ? 'BOOL' : 'NSNumber *');
    case 'EnumDeclaration':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return notStruct(isRequired ? 'double' : 'NSNumber *');
        case 'StringTypeAnnotation':
          return notStruct(wrapOptional('NSString *', !nullable));
        default:
          throw new Error(
            `Unsupported enum type for param "${paramName}" in ${methodName}. Found: ${typeAnnotation.type}`,
          );
      }
    case 'GenericObjectTypeAnnotation':
      return notStruct(wrapOptional('NSDictionary *', !nullable));
    default:
      structTypeAnnotation.type;
      throw new Error(
        `Unsupported type for param "${paramName}" in ${methodName}. Found: ${typeAnnotation.type}`,
      );
  }
}
function getReturnObjCType(methodName, nullableTypeAnnotation) {
  const _unwrapNullable11 = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable12 = _slicedToArray(_unwrapNullable11, 2),
    typeAnnotation = _unwrapNullable12[0],
    nullable = _unwrapNullable12[1];
  const isRequired = !nullable;
  switch (typeAnnotation.type) {
    case 'VoidTypeAnnotation':
      return 'void';
    case 'PromiseTypeAnnotation':
      return 'void';
    case 'ObjectTypeAnnotation':
      return wrapOptional('NSDictionary *', isRequired);
    case 'TypeAliasTypeAnnotation':
      return wrapOptional('NSDictionary *', isRequired);
    case 'ArrayTypeAnnotation':
      if (typeAnnotation.elementType.type === 'AnyTypeAnnotation') {
        return wrapOptional('NSArray<id<NSObject>> *', isRequired);
      }
      return wrapOptional(
        `NSArray<${getReturnObjCType(
          methodName,
          typeAnnotation.elementType,
        )}> *`,
        isRequired,
      );
    case 'ReservedTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'RootTag':
          return wrapOptional('NSNumber *', isRequired);
        default:
          typeAnnotation.name;
          throw new Error(
            `Unsupported return type for ${methodName}. Found: ${typeAnnotation.name}`,
          );
      }
    case 'StringTypeAnnotation':
      // TODO: Can NSString * returns not be _Nullable?
      // In the legacy codegen, we don't surround NSSTring * with _Nullable
      return wrapOptional('NSString *', isRequired);
    case 'StringLiteralTypeAnnotation':
      // TODO: Can NSString * returns not be _Nullable?
      // In the legacy codegen, we don't surround NSSTring * with _Nullable
      return wrapOptional('NSString *', isRequired);
    case 'StringLiteralUnionTypeAnnotation':
      // TODO: Can NSString * returns not be _Nullable?
      // In the legacy codegen, we don't surround NSSTring * with _Nullable
      return wrapOptional('NSString *', isRequired);
    case 'NumberTypeAnnotation':
      return wrapOptional('NSNumber *', isRequired);
    case 'NumberLiteralTypeAnnotation':
      return wrapOptional('NSNumber *', isRequired);
    case 'FloatTypeAnnotation':
      return wrapOptional('NSNumber *', isRequired);
    case 'DoubleTypeAnnotation':
      return wrapOptional('NSNumber *', isRequired);
    case 'Int32TypeAnnotation':
      return wrapOptional('NSNumber *', isRequired);
    case 'BooleanTypeAnnotation':
      return wrapOptional('NSNumber *', isRequired);
    case 'EnumDeclaration':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return wrapOptional('NSNumber *', isRequired);
        case 'StringTypeAnnotation':
          return wrapOptional('NSString *', isRequired);
        default:
          throw new Error(
            `Unsupported enum return type for ${methodName}. Found: ${typeAnnotation.type}`,
          );
      }
    case 'UnionTypeAnnotation':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return wrapOptional('NSNumber *', isRequired);
        case 'ObjectTypeAnnotation':
          return wrapOptional('NSDictionary *', isRequired);
        case 'StringTypeAnnotation':
          // TODO: Can NSString * returns not be _Nullable?
          // In the legacy codegen, we don't surround NSSTring * with _Nullable
          return wrapOptional('NSString *', isRequired);
        default:
          throw new Error(
            `Unsupported union return type for ${methodName}, found: ${typeAnnotation.memberType}"`,
          );
      }
    case 'GenericObjectTypeAnnotation':
      return wrapOptional('NSDictionary *', isRequired);
    default:
      typeAnnotation.type;
      throw new Error(
        `Unsupported return type for ${methodName}. Found: ${typeAnnotation.type}`,
      );
  }
}
function getReturnJSType(methodName, nullableTypeAnnotation) {
  const _unwrapNullable13 = unwrapNullable(nullableTypeAnnotation),
    _unwrapNullable14 = _slicedToArray(_unwrapNullable13, 1),
    typeAnnotation = _unwrapNullable14[0];
  switch (typeAnnotation.type) {
    case 'VoidTypeAnnotation':
      return 'VoidKind';
    case 'PromiseTypeAnnotation':
      return 'PromiseKind';
    case 'ObjectTypeAnnotation':
      return 'ObjectKind';
    case 'TypeAliasTypeAnnotation':
      return 'ObjectKind';
    case 'ArrayTypeAnnotation':
      return 'ArrayKind';
    case 'ReservedTypeAnnotation':
      return 'NumberKind';
    case 'StringTypeAnnotation':
      return 'StringKind';
    case 'StringLiteralTypeAnnotation':
      return 'StringKind';
    case 'StringLiteralUnionTypeAnnotation':
      return 'StringKind';
    case 'NumberTypeAnnotation':
      return 'NumberKind';
    case 'NumberLiteralTypeAnnotation':
      return 'NumberKind';
    case 'FloatTypeAnnotation':
      return 'NumberKind';
    case 'DoubleTypeAnnotation':
      return 'NumberKind';
    case 'Int32TypeAnnotation':
      return 'NumberKind';
    case 'BooleanTypeAnnotation':
      return 'BooleanKind';
    case 'GenericObjectTypeAnnotation':
      return 'ObjectKind';
    case 'EnumDeclaration':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return 'NumberKind';
        case 'StringTypeAnnotation':
          return 'StringKind';
        default:
          throw new Error(
            `Unsupported return type for ${methodName}. Found: ${typeAnnotation.type}`,
          );
      }
    case 'UnionTypeAnnotation':
      switch (typeAnnotation.memberType) {
        case 'NumberTypeAnnotation':
          return 'NumberKind';
        case 'ObjectTypeAnnotation':
          return 'ObjectKind';
        case 'StringTypeAnnotation':
          return 'StringKind';
        default:
          throw new Error(
            `Unsupported return type for ${methodName}. Found: ${typeAnnotation.type}`,
          );
      }
    default:
      typeAnnotation.type;
      throw new Error(
        `Unsupported return type for ${methodName}. Found: ${typeAnnotation.type}`,
      );
  }
}
function serializeConstantsProtocolMethods(
  hasteModuleName,
  property,
  structCollector,
  resolveAlias,
) {
  const _unwrapNullable15 = unwrapNullable(property.typeAnnotation),
    _unwrapNullable16 = _slicedToArray(_unwrapNullable15, 1),
    propertyTypeAnnotation = _unwrapNullable16[0];
  if (propertyTypeAnnotation.params.length !== 0) {
    throw new Error(
      `${hasteModuleName}.getConstants() may only accept 0 arguments.`,
    );
  }
  let returnTypeAnnotation = propertyTypeAnnotation.returnTypeAnnotation;
  if (returnTypeAnnotation.type === 'TypeAliasTypeAnnotation') {
    // The return type is an alias, resolve it to get the expected undelying object literal type
    returnTypeAnnotation = resolveAlias(returnTypeAnnotation.name);
  }
  if (returnTypeAnnotation.type !== 'ObjectTypeAnnotation') {
    throw new Error(
      `${hasteModuleName}.getConstants() may only return an object literal: {...}` +
        ` or a type alias of such. Got '${propertyTypeAnnotation.returnTypeAnnotation.type}'.`,
    );
  }
  if (
    returnTypeAnnotation.type === 'ObjectTypeAnnotation' &&
    returnTypeAnnotation.properties.length === 0
  ) {
    return [];
  }
  const realTypeAnnotation = structCollector.process(
    'Constants',
    'CONSTANTS',
    resolveAlias,
    returnTypeAnnotation,
  );
  invariant(
    realTypeAnnotation.type === 'TypeAliasTypeAnnotation',
    "Unable to generate C++ struct from module's getConstants() method return type.",
  );
  const returnObjCType = `facebook::react::ModuleConstants<JS::${hasteModuleName}::Constants::Builder>`;

  // $FlowFixMe[missing-type-arg]
  return ['constantsToExport', 'getConstants'].map(methodName => {
    const protocolMethod = ProtocolMethodTemplate({
      methodName,
      returnObjCType,
      params: '',
    });
    return {
      methodName,
      protocolMethod,
      returnJSType: 'ObjectKind',
      selector: `@selector(${methodName})`,
      structParamRecords: [],
      argCount: 0,
    };
  });
}
module.exports = {
  serializeMethod,
};
