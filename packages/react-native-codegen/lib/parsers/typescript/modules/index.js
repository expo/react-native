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

const _require = require('../../errors'),
  UnsupportedEnumDeclarationParserError =
    _require.UnsupportedEnumDeclarationParserError,
  UnsupportedGenericParserError = _require.UnsupportedGenericParserError,
  UnsupportedObjectPropertyWithIndexerTypeAnnotationParserError =
    _require.UnsupportedObjectPropertyWithIndexerTypeAnnotationParserError,
  UnsupportedTypeAnnotationParserError =
    _require.UnsupportedTypeAnnotationParserError;
const _require2 = require('../../parsers-commons'),
  parseObjectProperty = _require2.parseObjectProperty;
const _require3 = require('../../parsers-primitives'),
  emitArrayType = _require3.emitArrayType,
  emitCommonTypes = _require3.emitCommonTypes,
  emitDictionary = _require3.emitDictionary,
  emitFunction = _require3.emitFunction,
  emitNumberLiteral = _require3.emitNumberLiteral,
  emitPromise = _require3.emitPromise,
  emitRootTag = _require3.emitRootTag,
  emitStringLiteral = _require3.emitStringLiteral,
  emitUnion = _require3.emitUnion,
  translateArrayTypeAnnotation = _require3.translateArrayTypeAnnotation,
  typeAliasResolution = _require3.typeAliasResolution,
  typeEnumResolution = _require3.typeEnumResolution;
const _require4 = require('../components/componentsUtils'),
  flattenProperties = _require4.flattenProperties;
const _require5 = require('../parseTopLevelType'),
  flattenIntersectionType = _require5.flattenIntersectionType;
function translateObjectTypeAnnotation(
  hasteModuleName,
  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
  typeScriptTypeAnnotation,
  nullable,
  objectMembers,
  typeResolutionStatus,
  baseTypes,
  types,
  aliasMap,
  enumMap,
  tryParse,
  cxxOnly,
  parser,
) {
  // $FlowFixMe[missing-type-arg]
  const properties = objectMembers
    .map(property => {
      return tryParse(() => {
        return parseObjectProperty(
          typeScriptTypeAnnotation,
          property,
          hasteModuleName,
          types,
          aliasMap,
          enumMap,
          tryParse,
          cxxOnly,
          nullable,
          translateTypeAnnotation,
          parser,
        );
      });
    })
    .filter(Boolean);
  let objectTypeAnnotation;
  if (baseTypes.length === 0) {
    objectTypeAnnotation = {
      type: 'ObjectTypeAnnotation',
      properties,
    };
  } else {
    objectTypeAnnotation = {
      type: 'ObjectTypeAnnotation',
      properties,
      baseTypes,
    };
  }
  return typeAliasResolution(
    typeResolutionStatus,
    objectTypeAnnotation,
    aliasMap,
    nullable,
  );
}
function translateTypeReferenceAnnotation(
  typeName,
  nullable,
  typeAnnotation,
  hasteModuleName,
  types,
  aliasMap,
  enumMap,
  tryParse,
  cxxOnly,
  parser,
) {
  switch (typeName) {
    case 'RootTag': {
      return emitRootTag(nullable);
    }
    case 'Promise': {
      return emitPromise(
        hasteModuleName,
        typeAnnotation,
        parser,
        nullable,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        translateTypeAnnotation,
      );
    }
    case 'Array':
    case 'ReadonlyArray': {
      return emitArrayType(
        hasteModuleName,
        typeAnnotation,
        parser,
        types,
        aliasMap,
        enumMap,
        cxxOnly,
        nullable,
        translateTypeAnnotation,
      );
    }
    default: {
      const commonType = emitCommonTypes(
        hasteModuleName,
        types,
        typeAnnotation,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        nullable,
        parser,
      );
      if (!commonType) {
        throw new UnsupportedGenericParserError(
          hasteModuleName,
          typeAnnotation,
          parser,
        );
      }
      return commonType;
    }
  }
}
function translateTypeAnnotation(
  hasteModuleName,
  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
  typeScriptTypeAnnotation,
  types,
  aliasMap,
  enumMap,
  tryParse,
  cxxOnly,
  parser,
) {
  const _parser$getResolvedTy = parser.getResolvedTypeAnnotation(
      typeScriptTypeAnnotation,
      types,
      parser,
    ),
    nullable = _parser$getResolvedTy.nullable,
    typeAnnotation = _parser$getResolvedTy.typeAnnotation,
    typeResolutionStatus = _parser$getResolvedTy.typeResolutionStatus;
  const resolveTypeaAnnotationFn = parser.getResolveTypeAnnotationFN();
  resolveTypeaAnnotationFn(typeScriptTypeAnnotation, types, parser);
  switch (typeAnnotation.type) {
    case 'TSArrayType': {
      return translateArrayTypeAnnotation(
        hasteModuleName,
        types,
        aliasMap,
        enumMap,
        cxxOnly,
        'Array',
        typeAnnotation.elementType,
        nullable,
        translateTypeAnnotation,
        parser,
      );
    }
    case 'TSTypeOperator': {
      if (
        typeAnnotation.operator === 'readonly' &&
        typeAnnotation.typeAnnotation.type === 'TSArrayType'
      ) {
        return translateArrayTypeAnnotation(
          hasteModuleName,
          types,
          aliasMap,
          enumMap,
          cxxOnly,
          'ReadonlyArray',
          typeAnnotation.typeAnnotation.elementType,
          nullable,
          translateTypeAnnotation,
          parser,
        );
      } else {
        throw new UnsupportedGenericParserError(
          hasteModuleName,
          typeAnnotation,
          parser,
        );
      }
    }
    case 'TSTypeReference': {
      return translateTypeReferenceAnnotation(
        parser.getTypeAnnotationName(typeAnnotation),
        nullable,
        typeAnnotation,
        hasteModuleName,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        parser,
      );
    }
    case 'TSInterfaceDeclaration': {
      var _typeAnnotation$exten;
      const baseTypes = (
        (_typeAnnotation$exten = typeAnnotation.extends) !== null &&
        _typeAnnotation$exten !== void 0
          ? _typeAnnotation$exten
          : []
      ).map(extend => extend.expression.name);
      for (const baseType of baseTypes) {
        // ensure base types exist and appear in aliasMap
        translateTypeAnnotation(
          hasteModuleName,
          {
            type: 'TSTypeReference',
            typeName: {
              type: 'Identifier',
              name: baseType,
            },
          },
          types,
          aliasMap,
          enumMap,
          tryParse,
          cxxOnly,
          parser,
        );
      }
      return translateObjectTypeAnnotation(
        hasteModuleName,
        typeScriptTypeAnnotation,
        nullable,
        flattenProperties([typeAnnotation], types, parser),
        typeResolutionStatus,
        baseTypes,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        parser,
      );
    }
    case 'TSIntersectionType': {
      return translateObjectTypeAnnotation(
        hasteModuleName,
        typeScriptTypeAnnotation,
        nullable,
        flattenProperties(
          flattenIntersectionType(typeAnnotation, types),
          types,
          parser,
        ),
        typeResolutionStatus,
        [],
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        parser,
      );
    }
    case 'TSTypeLiteral': {
      // if there is TSIndexSignature, then it is a dictionary
      if (typeAnnotation.members) {
        const indexSignatures = typeAnnotation.members.filter(
          member => member.type === 'TSIndexSignature',
        );
        const properties = typeAnnotation.members.filter(
          member => member.type === 'TSPropertySignature',
        );
        if (indexSignatures.length > 0 && properties.length > 0) {
          throw new UnsupportedObjectPropertyWithIndexerTypeAnnotationParserError(
            hasteModuleName,
            typeAnnotation,
          );
        }
        if (indexSignatures.length > 0) {
          // check the property type to prevent developers from using unsupported types
          // the return value from `translateTypeAnnotation` is unused
          const propertyType = indexSignatures[0].typeAnnotation;
          const valueType = translateTypeAnnotation(
            hasteModuleName,
            propertyType,
            types,
            aliasMap,
            enumMap,
            tryParse,
            cxxOnly,
            parser,
          );
          // no need to do further checking
          return emitDictionary(nullable, valueType);
        }
      }
      return translateObjectTypeAnnotation(
        hasteModuleName,
        typeScriptTypeAnnotation,
        nullable,
        typeAnnotation.members,
        typeResolutionStatus,
        [],
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        parser,
      );
    }
    case 'TSEnumDeclaration': {
      if (
        typeAnnotation.members.some(
          m =>
            m.initializer &&
            m.initializer.type === 'NumericLiteral' &&
            !Number.isInteger(m.initializer.value),
        )
      ) {
        throw new UnsupportedEnumDeclarationParserError(
          hasteModuleName,
          typeAnnotation,
          parser.language(),
        );
      }
      return typeEnumResolution(
        typeAnnotation,
        typeResolutionStatus,
        nullable,
        hasteModuleName,
        enumMap,
        parser,
      );
    }
    case 'TSFunctionType': {
      return emitFunction(
        nullable,
        hasteModuleName,
        typeAnnotation,
        types,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        translateTypeAnnotation,
        parser,
      );
    }
    case 'TSUnionType': {
      return emitUnion(nullable, hasteModuleName, typeAnnotation, parser);
    }
    case 'TSLiteralType': {
      const literal = typeAnnotation.literal;
      switch (literal.type) {
        case 'StringLiteral': {
          return emitStringLiteral(nullable, literal.value);
        }
        case 'NumericLiteral': {
          return emitNumberLiteral(nullable, literal.value);
        }
        default: {
          throw new UnsupportedTypeAnnotationParserError(
            hasteModuleName,
            typeAnnotation,
            parser.language(),
          );
        }
      }
    }
    default: {
      const commonType = emitCommonTypes(
        hasteModuleName,
        types,
        typeAnnotation,
        aliasMap,
        enumMap,
        tryParse,
        cxxOnly,
        nullable,
        parser,
      );
      if (!commonType) {
        throw new UnsupportedTypeAnnotationParserError(
          hasteModuleName,
          typeAnnotation,
          parser.language(),
        );
      }
      return commonType;
    }
  }
}
module.exports = {
  typeScriptTranslateTypeAnnotation: translateTypeAnnotation,
};
