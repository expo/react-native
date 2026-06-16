'use strict';

const {
  throwIfArrayElementTypeAnnotationIsUnsupported,
  throwIfPartialNotAnnotatingTypeParameter,
  throwIfPartialWithMoreParameter
} = require('./error-utils');
const {
  ParserError,
  UnsupportedTypeAnnotationParserError
} = require('./errors');
const {
  assertGenericTypeAnnotationHasExactlyOneTypeParameter,
  translateFunctionTypeAnnotation,
  unwrapNullable,
  wrapNullable
} = require('./parsers-commons');
const {
  nullGuard
} = require('./parsers-utils');
const {
  isModuleRegistryCall
} = require('./utils');
function emitBoolean(nullable) {
  return wrapNullable(nullable, {
    type: 'BooleanTypeAnnotation'
  });
}
function emitInt32(nullable) {
  return wrapNullable(nullable, {
    type: 'Int32TypeAnnotation'
  });
}
function emitInt32Prop(name, optional) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'Int32TypeAnnotation'
    }
  };
}
function emitNumber(nullable) {
  return wrapNullable(nullable, {
    type: 'NumberTypeAnnotation'
  });
}
function emitRootTag(nullable) {
  return wrapNullable(nullable, {
    type: 'ReservedTypeAnnotation',
    name: 'RootTag'
  });
}
function emitDouble(nullable) {
  return wrapNullable(nullable, {
    type: 'DoubleTypeAnnotation'
  });
}
function emitDoubleProp(name, optional) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'DoubleTypeAnnotation'
    }
  };
}
function emitVoid(nullable) {
  return wrapNullable(nullable, {
    type: 'VoidTypeAnnotation'
  });
}
function emitStringish(nullable) {
  return wrapNullable(nullable, {
    type: 'StringTypeAnnotation'
  });
}
function emitFunction(nullable, hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation, parser) {
  const translateFunctionTypeAnnotationValue = translateFunctionTypeAnnotation(hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation, parser);
  return wrapNullable(nullable, translateFunctionTypeAnnotationValue);
}
function emitMixed(nullable) {
  return wrapNullable(nullable, {
    type: 'MixedTypeAnnotation'
  });
}
function emitNumberLiteral(nullable, value) {
  return wrapNullable(nullable, {
    type: 'NumberLiteralTypeAnnotation',
    value
  });
}
function emitBooleanLiteral(nullable, value) {
  return wrapNullable(nullable, {
    type: 'BooleanLiteralTypeAnnotation',
    value
  });
}
function emitString(nullable) {
  return wrapNullable(nullable, {
    type: 'StringTypeAnnotation'
  });
}
function emitStringLiteral(nullable, value) {
  return wrapNullable(nullable, {
    type: 'StringLiteralTypeAnnotation',
    value
  });
}
function emitStringProp(name, optional) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'StringTypeAnnotation'
    }
  };
}
function typeAliasResolution(typeResolution, objectTypeAnnotation, aliasMap, nullable) {
  if (!typeResolution.successful) {
    return wrapNullable(nullable, objectTypeAnnotation);
  }
  aliasMap[typeResolution.name] = objectTypeAnnotation;
  return wrapNullable(nullable, {
    type: 'TypeAliasTypeAnnotation',
    name: typeResolution.name
  });
}
function typeEnumResolution(typeAnnotation, typeResolution, nullable, hasteModuleName, enumMap, parser) {
  if (!typeResolution.successful || typeResolution.type !== 'enum') {
    throw new UnsupportedTypeAnnotationParserError(hasteModuleName, typeAnnotation, parser.language());
  }
  const enumName = typeResolution.name;
  const enumMemberType = parser.parseEnumMembersType(typeAnnotation);
  try {
    parser.validateEnumMembersSupported(typeAnnotation, enumMemberType);
  } catch (e) {
    if (e instanceof Error) {
      throw new ParserError(hasteModuleName, typeAnnotation, `Failed parsing the enum ${enumName} in ${hasteModuleName} with the error: ${e.message}`);
    } else {
      throw e;
    }
  }
  const enumMembers = parser.parseEnumMembers(typeAnnotation);
  enumMap[enumName] = {
    name: enumName,
    type: 'EnumDeclarationWithMembers',
    memberType: enumMemberType,
    members: enumMembers
  };
  return wrapNullable(nullable, {
    name: enumName,
    type: 'EnumDeclaration',
    memberType: enumMemberType
  });
}
function emitPromise(hasteModuleName, typeAnnotation, parser, nullable, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation) {
  assertGenericTypeAnnotationHasExactlyOneTypeParameter(hasteModuleName, typeAnnotation, parser);
  const elementType = typeAnnotation.typeParameters.params[0];
  if (elementType.type === 'ExistsTypeAnnotation' || elementType.type === 'EmptyTypeAnnotation') {
    return wrapNullable(nullable, {
      type: 'PromiseTypeAnnotation',
      elementType: {
        type: 'VoidTypeAnnotation'
      }
    });
  } else {
    try {
      return wrapNullable(nullable, {
        type: 'PromiseTypeAnnotation',
        elementType: translateTypeAnnotation(hasteModuleName, typeAnnotation.typeParameters.params[0], types, aliasMap, enumMap, tryParse, cxxOnly, parser)
      });
    } catch {
      return wrapNullable(nullable, {
        type: 'PromiseTypeAnnotation',
        elementType: {
          type: 'VoidTypeAnnotation'
        }
      });
    }
  }
}
function emitGenericObject(nullable) {
  return wrapNullable(nullable, {
    type: 'GenericObjectTypeAnnotation'
  });
}
function emitDictionary(nullable, valueType) {
  return wrapNullable(nullable, {
    type: 'GenericObjectTypeAnnotation',
    dictionaryValueType: valueType
  });
}
function emitObject(nullable, properties) {
  return wrapNullable(nullable, {
    type: 'ObjectTypeAnnotation',
    properties
  });
}
function emitFloat(nullable) {
  return wrapNullable(nullable, {
    type: 'FloatTypeAnnotation'
  });
}
function emitFloatProp(name, optional) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'FloatTypeAnnotation'
    }
  };
}
function emitUnion(nullable, hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation, parser) {
  const unparsedMemberTypes = typeAnnotation.types;
  const memberTypes = unparsedMemberTypes.map(memberType => {
    const memberTypeAnnotation = translateTypeAnnotation(hasteModuleName, memberType, types, aliasMap, enumMap, tryParse, cxxOnly, parser);
    switch (memberTypeAnnotation.type) {
      case 'StringTypeAnnotation':
      case 'NumberTypeAnnotation':
      case 'BooleanTypeAnnotation':
      case 'NumberLiteralTypeAnnotation':
      case 'StringLiteralTypeAnnotation':
      case 'BooleanLiteralTypeAnnotation':
      case 'ObjectTypeAnnotation':
      case 'TypeAliasTypeAnnotation':
        return memberTypeAnnotation;
      default:
        throw new UnsupportedTypeAnnotationParserError(hasteModuleName, memberType, parser.language());
    }
  });
  return wrapNullable(nullable, {
    type: 'UnionTypeAnnotation',
    types: memberTypes
  });
}
function translateArrayTypeAnnotation(hasteModuleName, types, aliasMap, enumMap, cxxOnly, arrayType, elementType, nullable, translateTypeAnnotation, parser) {
  try {
    const [_elementType, isElementTypeNullable] = unwrapNullable(translateTypeAnnotation(hasteModuleName, elementType, types, aliasMap, enumMap, nullGuard, cxxOnly, parser));
    throwIfArrayElementTypeAnnotationIsUnsupported(hasteModuleName, elementType, arrayType, _elementType.type);
    return wrapNullable(nullable, {
      type: 'ArrayTypeAnnotation',
      elementType: wrapNullable(isElementTypeNullable, _elementType)
    });
  } catch (ex) {
    return wrapNullable(nullable, {
      type: 'ArrayTypeAnnotation',
      elementType: {
        type: 'AnyTypeAnnotation'
      }
    });
  }
}
function emitArrayType(hasteModuleName, typeAnnotation, parser, types, aliasMap, enumMap, cxxOnly, nullable, translateTypeAnnotation) {
  assertGenericTypeAnnotationHasExactlyOneTypeParameter(hasteModuleName, typeAnnotation, parser);
  return translateArrayTypeAnnotation(hasteModuleName, types, aliasMap, enumMap, cxxOnly, typeAnnotation.type, typeAnnotation.typeParameters.params[0], nullable, translateTypeAnnotation, parser);
}
function Visitor(infoMap) {
  return {
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'codegenNativeComponent') {
        infoMap.isComponent = true;
      }
      if (isModuleRegistryCall(node)) {
        infoMap.isModule = true;
      }
    },
    InterfaceExtends(node) {
      if (node.id.name === 'TurboModule') {
        infoMap.isModule = true;
      }
    },
    TSInterfaceDeclaration(node) {
      if (Array.isArray(node.extends) && node.extends.some(extension => extension.expression.name === 'TurboModule')) {
        infoMap.isModule = true;
      }
    }
  };
}
function emitPartial(nullable, hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, parser) {
  throwIfPartialWithMoreParameter(typeAnnotation);
  throwIfPartialNotAnnotatingTypeParameter(typeAnnotation, types, parser);
  const annotatedElement = parser.extractAnnotatedElement(typeAnnotation, types);
  const annotatedElementProperties = parser.getAnnotatedElementProperties(annotatedElement);
  const partialProperties = parser.computePartialProperties(annotatedElementProperties, hasteModuleName, types, aliasMap, enumMap, tryParse, cxxOnly);
  return emitObject(nullable, partialProperties);
}
function emitCommonTypes(hasteModuleName, types, typeAnnotation, aliasMap, enumMap, tryParse, cxxOnly, nullable, parser) {
  const typeMap = {
    Stringish: emitStringish,
    Int32: emitInt32,
    Double: emitDouble,
    Float: emitFloat,
    UnsafeObject: emitGenericObject,
    Object: emitGenericObject,
    $Partial: emitPartial,
    Partial: emitPartial,
    BooleanTypeAnnotation: emitBoolean,
    NumberTypeAnnotation: emitNumber,
    VoidTypeAnnotation: emitVoid,
    StringTypeAnnotation: emitString,
    MixedTypeAnnotation: cxxOnly ? emitMixed : emitGenericObject,
    UnsafeMixed: cxxOnly ? emitMixed : emitGenericObject,
    unknown: cxxOnly ? emitMixed : emitGenericObject,
    UnknownTypeAnnotation: cxxOnly ? emitMixed : emitGenericObject
  };
  const typeAnnotationName = parser.convertKeywordToTypeAnnotation(typeAnnotation.type);
  const simpleEmitter = typeMap[typeAnnotationName];
  if (simpleEmitter) {
    return simpleEmitter(nullable);
  }
  const genericTypeAnnotationName = parser.getTypeAnnotationName(typeAnnotation);
  const emitter = typeMap[genericTypeAnnotationName];
  if (!emitter) {
    return null;
  }
  return emitter(nullable, hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, parser);
}
function emitBoolProp(name, optional) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'BooleanTypeAnnotation'
    }
  };
}
function emitMixedProp(name, optional) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'MixedTypeAnnotation'
    }
  };
}
function emitObjectProp(name, optional, parser, typeAnnotation, extractArrayElementType) {
  return {
    name,
    optional,
    typeAnnotation: extractArrayElementType(typeAnnotation, name, parser)
  };
}
function emitUnionProp(name, optional, parser, typeAnnotation) {
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'UnionTypeAnnotation',
      types: typeAnnotation.types.map(option => ({
        type: 'StringLiteralTypeAnnotation',
        value: parser.getLiteralValue(option)
      }))
    }
  };
}
module.exports = {
  emitArrayType,
  emitBoolean,
  emitBooleanLiteral,
  emitBoolProp,
  emitDouble,
  emitDoubleProp,
  emitFloat,
  emitFloatProp,
  emitFunction,
  emitInt32,
  emitInt32Prop,
  emitMixedProp,
  emitNumber,
  emitNumberLiteral,
  emitGenericObject,
  emitDictionary,
  emitObject,
  emitPromise,
  emitRootTag,
  emitVoid,
  emitString,
  emitStringish,
  emitStringProp,
  emitStringLiteral,
  emitMixed,
  emitUnion,
  emitPartial,
  emitCommonTypes,
  typeAliasResolution,
  typeEnumResolution,
  translateArrayTypeAnnotation,
  Visitor,
  emitObjectProp,
  emitUnionProp
};