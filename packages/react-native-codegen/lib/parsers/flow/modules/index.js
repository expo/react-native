'use strict';

const {
  UnsupportedEnumDeclarationParserError,
  UnsupportedGenericParserError,
  UnsupportedObjectPropertyWithIndexerTypeAnnotationParserError,
  UnsupportedTypeAnnotationParserError
} = require('../../errors');
const {
  assertGenericTypeAnnotationHasExactlyOneTypeParameter,
  parseObjectProperty,
  unwrapNullable,
  wrapNullable
} = require('../../parsers-commons');
const {
  emitArrayType,
  emitBooleanLiteral,
  emitCommonTypes,
  emitDictionary,
  emitFunction,
  emitNumberLiteral,
  emitPromise,
  emitRootTag,
  emitUnion,
  translateArrayTypeAnnotation,
  typeAliasResolution,
  typeEnumResolution
} = require('../../parsers-primitives');
function translateTypeAnnotation(hasteModuleName, flowTypeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, parser) {
  const resolveTypeAnnotationFN = parser.getResolveTypeAnnotationFN();
  const {
    nullable,
    typeAnnotation,
    typeResolutionStatus
  } = resolveTypeAnnotationFN(flowTypeAnnotation, types, parser);
  switch (typeAnnotation.type) {
    case 'ArrayTypeAnnotation':
      {
        return translateArrayTypeAnnotation(hasteModuleName, types, aliasMap, enumMap, cxxOnly, 'Array', typeAnnotation.elementType, nullable, translateTypeAnnotation, parser);
      }
    case 'GenericTypeAnnotation':
      {
        switch (parser.getTypeAnnotationName(typeAnnotation)) {
          case 'RootTag':
            {
              return emitRootTag(nullable);
            }
          case 'Promise':
            {
              return emitPromise(hasteModuleName, typeAnnotation, parser, nullable, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation);
            }
          case 'Array':
          case '$ReadOnlyArray':
          case 'ReadonlyArray':
            {
              return emitArrayType(hasteModuleName, typeAnnotation, parser, types, aliasMap, enumMap, cxxOnly, nullable, translateTypeAnnotation);
            }
          case '$ReadOnly':
          case 'Readonly':
            {
              assertGenericTypeAnnotationHasExactlyOneTypeParameter(hasteModuleName, typeAnnotation, parser);
              const [paramType, isParamNullable] = unwrapNullable(translateTypeAnnotation(hasteModuleName, typeAnnotation.typeParameters.params[0], types, aliasMap, enumMap, tryParse, cxxOnly, parser));
              return wrapNullable(nullable || isParamNullable, paramType);
            }
          default:
            {
              const commonType = emitCommonTypes(hasteModuleName, types, typeAnnotation, aliasMap, enumMap, tryParse, cxxOnly, nullable, parser);
              if (!commonType) {
                throw new UnsupportedGenericParserError(hasteModuleName, typeAnnotation, parser);
              }
              return commonType;
            }
        }
      }
    case 'ObjectTypeAnnotation':
      {
        if (typeAnnotation.indexers) {
          const indexers = typeAnnotation.indexers.filter(member => member.type === 'ObjectTypeIndexer');
          if (indexers.length > 0 && typeAnnotation.properties.length > 0) {
            throw new UnsupportedObjectPropertyWithIndexerTypeAnnotationParserError(hasteModuleName, typeAnnotation);
          }
          if (indexers.length > 0) {
            const propertyType = indexers[0].value;
            const valueType = translateTypeAnnotation(hasteModuleName, propertyType, types, aliasMap, enumMap, tryParse, cxxOnly, parser);
            return emitDictionary(nullable, valueType);
          }
        }
        const objectTypeAnnotation = {
          type: 'ObjectTypeAnnotation',
          properties: [...typeAnnotation.properties, ...typeAnnotation.indexers].map(property => {
            return tryParse(() => {
              return parseObjectProperty(flowTypeAnnotation, property, hasteModuleName, types, aliasMap, enumMap, tryParse, cxxOnly, nullable, translateTypeAnnotation, parser);
            });
          }).filter(Boolean)
        };
        return typeAliasResolution(typeResolutionStatus, objectTypeAnnotation, aliasMap, nullable);
      }
    case 'FunctionTypeAnnotation':
      {
        return emitFunction(nullable, hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation, parser);
      }
    case 'UnionTypeAnnotation':
      {
        return emitUnion(nullable, hasteModuleName, typeAnnotation, types, aliasMap, enumMap, tryParse, cxxOnly, translateTypeAnnotation, parser);
      }
    case 'NumberLiteralTypeAnnotation':
      {
        return emitNumberLiteral(nullable, typeAnnotation.value);
      }
    case 'BooleanLiteralTypeAnnotation':
      {
        return emitBooleanLiteral(nullable, typeAnnotation.value);
      }
    case 'StringLiteralTypeAnnotation':
      {
        return wrapNullable(nullable, {
          type: 'StringLiteralTypeAnnotation',
          value: typeAnnotation.value
        });
      }
    case 'EnumStringBody':
    case 'EnumNumberBody':
      {
        if (typeAnnotation.type === 'EnumNumberBody' && typeAnnotation.members.some(m => {
          var _m$init;
          return m.type === 'EnumNumberMember' && !Number.isInteger((_m$init = m.init) === null || _m$init === void 0 ? void 0 : _m$init.value);
        })) {
          throw new UnsupportedEnumDeclarationParserError(hasteModuleName, typeAnnotation, parser.language());
        }
        return typeEnumResolution(typeAnnotation, typeResolutionStatus, nullable, hasteModuleName, enumMap, parser);
      }
    default:
      {
        const commonType = emitCommonTypes(hasteModuleName, types, typeAnnotation, aliasMap, enumMap, tryParse, cxxOnly, nullable, parser);
        if (!commonType) {
          throw new UnsupportedTypeAnnotationParserError(hasteModuleName, typeAnnotation, parser.language());
        }
        return commonType;
      }
  }
}
module.exports = {
  flowTranslateTypeAnnotation: translateTypeAnnotation
};