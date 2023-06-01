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

const _require = require('../parseTopLevelType'),
  flattenIntersectionType = _require.flattenIntersectionType;
const _require2 = require('../components/componentsUtils'),
  flattenProperties = _require2.flattenProperties;
const _require3 = require('../utils'),
  resolveTypeAnnotation = _require3.resolveTypeAnnotation;
const _require4 = require('../../parsers-commons'),
  parseObjectProperty = _require4.parseObjectProperty;
const _require5 = require('../../parsers-primitives'),
  emitArrayType = _require5.emitArrayType,
  emitBoolean = _require5.emitBoolean,
  emitFunction = _require5.emitFunction,
  emitNumber = _require5.emitNumber,
  emitGenericObject = _require5.emitGenericObject,
  emitPromise = _require5.emitPromise,
  emitRootTag = _require5.emitRootTag,
  emitVoid = _require5.emitVoid,
  emitString = _require5.emitString,
  emitMixed = _require5.emitMixed,
  emitUnion = _require5.emitUnion,
  emitCommonTypes = _require5.emitCommonTypes,
  typeAliasResolution = _require5.typeAliasResolution,
  typeEnumResolution = _require5.typeEnumResolution,
  translateArrayTypeAnnotation = _require5.translateArrayTypeAnnotation;
const _require6 = require('../../errors'),
  UnsupportedGenericParserError = _require6.UnsupportedGenericParserError,
  UnsupportedTypeAnnotationParserError =
    _require6.UnsupportedTypeAnnotationParserError;
function translateObjectTypeAnnotation(
  hasteModuleName,
  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
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
  const _resolveTypeAnnotatio = resolveTypeAnnotation(
      typeScriptTypeAnnotation,
      types,
    ),
    nullable = _resolveTypeAnnotatio.nullable,
    typeAnnotation = _resolveTypeAnnotatio.typeAnnotation,
    typeResolutionStatus = _resolveTypeAnnotatio.typeResolutionStatus;
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
        typeAnnotation.typeName.name,
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
        nullable,
        flattenProperties([typeAnnotation], types),
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
        nullable,
        flattenProperties(
          flattenIntersectionType(typeAnnotation, types),
          types,
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
        if (indexSignatures.length > 0) {
          // check the property type to prevent developers from using unsupported types
          // the return value from `translateTypeAnnotation` is unused
          const propertyType = indexSignatures[0].typeAnnotation;
          translateTypeAnnotation(
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
          return emitGenericObject(nullable);
        }
      }
      return translateObjectTypeAnnotation(
        hasteModuleName,
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
      return typeEnumResolution(
        typeAnnotation,
        typeResolutionStatus,
        nullable,
        hasteModuleName,
        enumMap,
        parser,
      );
    }
    case 'TSBooleanKeyword': {
      return emitBoolean(nullable);
    }
    case 'TSNumberKeyword': {
      return emitNumber(nullable);
    }
    case 'TSVoidKeyword': {
      return emitVoid(nullable);
    }
    case 'TSStringKeyword': {
      return emitString(nullable);
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
    case 'TSUnknownKeyword': {
      if (cxxOnly) {
        return emitMixed(nullable);
      }
      // Fallthrough
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
module.exports = {
  typeScriptTranslateTypeAnnotation: translateTypeAnnotation,
};
