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

function _defineProperty(obj, key, value) {
  key = _toPropertyKey(key);
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  } else {
    obj[key] = value;
  }
  return obj;
}
function _toPropertyKey(arg) {
  var key = _toPrimitive(arg, 'string');
  return typeof key === 'symbol' ? key : String(key);
}
function _toPrimitive(input, hint) {
  if (typeof input !== 'object' || input === null) return input;
  var prim = input[Symbol.toPrimitive];
  if (prim !== undefined) {
    var res = prim.call(input, hint || 'default');
    if (typeof res !== 'object') return res;
    throw new TypeError('@@toPrimitive must return a primitive value.');
  }
  return (hint === 'string' ? String : Number)(input);
}
const _require = require('./modules'),
  typeScriptTranslateTypeAnnotation =
    _require.typeScriptTranslateTypeAnnotation;

// $FlowFixMe[untyped-import] Use flow-types for @babel/parser
const babelParser = require('@babel/parser');
const _require2 = require('../parsers-commons'),
  buildSchema = _require2.buildSchema;
const _require3 = require('../parsers-primitives'),
  Visitor = _require3.Visitor;
const _require4 = require('./components'),
  buildComponentSchema = _require4.buildComponentSchema;
const _require5 = require('../schema.js'),
  wrapComponentSchema = _require5.wrapComponentSchema;
const _require6 = require('../parsers-commons.js'),
  buildModuleSchema = _require6.buildModuleSchema;
const _require7 = require('./utils'),
  resolveTypeAnnotation = _require7.resolveTypeAnnotation;
const fs = require('fs');
const _require8 = require('../errors'),
  UnsupportedObjectPropertyTypeAnnotationParserError =
    _require8.UnsupportedObjectPropertyTypeAnnotationParserError;
class TypeScriptParser {
  constructor() {
    _defineProperty(
      this,
      'typeParameterInstantiation',
      'TSTypeParameterInstantiation',
    );
  }
  isProperty(property) {
    return property.type === 'TSPropertySignature';
  }
  getKeyName(property, hasteModuleName) {
    if (!this.isProperty(property)) {
      throw new UnsupportedObjectPropertyTypeAnnotationParserError(
        hasteModuleName,
        property,
        property.type,
        this.language(),
      );
    }
    return property.key.name;
  }
  language() {
    return 'TypeScript';
  }
  nameForGenericTypeAnnotation(typeAnnotation) {
    return typeAnnotation.typeName.name;
  }
  checkIfInvalidModule(typeArguments) {
    return (
      typeArguments.type !== 'TSTypeParameterInstantiation' ||
      typeArguments.params.length !== 1 ||
      typeArguments.params[0].type !== 'TSTypeReference' ||
      typeArguments.params[0].typeName.name !== 'Spec'
    );
  }
  remapUnionTypeAnnotationMemberNames(membersTypes) {
    const remapLiteral = item => {
      return item.literal
        ? item.literal.type
            .replace('NumericLiteral', 'NumberTypeAnnotation')
            .replace('StringLiteral', 'StringTypeAnnotation')
        : 'ObjectTypeAnnotation';
    };
    return [...new Set(membersTypes.map(remapLiteral))];
  }
  parseFile(filename) {
    const contents = fs.readFileSync(filename, 'utf8');
    return this.parseString(contents, filename);
  }
  parseString(contents, filename) {
    return buildSchema(
      contents,
      filename,
      wrapComponentSchema,
      buildComponentSchema,
      buildModuleSchema,
      Visitor,
      this,
      resolveTypeAnnotation,
      typeScriptTranslateTypeAnnotation,
    );
  }
  parseModuleFixture(filename) {
    const contents = fs.readFileSync(filename, 'utf8');
    return this.parseString(contents, 'path/NativeSampleTurboModule.ts');
  }
  getAst(contents) {
    return babelParser.parse(contents, {
      sourceType: 'module',
      plugins: ['typescript'],
    }).program;
  }
  getFunctionTypeAnnotationParameters(functionTypeAnnotation) {
    return functionTypeAnnotation.parameters;
  }
  getFunctionNameFromParameter(parameter) {
    return parameter.typeAnnotation;
  }
  getParameterName(parameter) {
    return parameter.name;
  }
  getParameterTypeAnnotation(parameter) {
    return parameter.typeAnnotation.typeAnnotation;
  }
  getFunctionTypeAnnotationReturnType(functionTypeAnnotation) {
    return functionTypeAnnotation.typeAnnotation.typeAnnotation;
  }
  parseEnumMembersType(typeAnnotation) {
    var _typeAnnotation$membe;
    const enumInitializer =
      (_typeAnnotation$membe = typeAnnotation.members[0]) === null ||
      _typeAnnotation$membe === void 0
        ? void 0
        : _typeAnnotation$membe.initializer;
    const enumMembersType =
      !enumInitializer || enumInitializer.type === 'StringLiteral'
        ? 'StringTypeAnnotation'
        : enumInitializer.type === 'NumericLiteral'
        ? 'NumberTypeAnnotation'
        : null;
    if (!enumMembersType) {
      throw new Error(
        'Enum values must be either blank, number, or string values.',
      );
    }
    return enumMembersType;
  }
  validateEnumMembersSupported(typeAnnotation, enumMembersType) {
    if (!typeAnnotation.members || typeAnnotation.members.length === 0) {
      throw new Error('Enums should have at least one member.');
    }
    const enumInitializerType =
      enumMembersType === 'StringTypeAnnotation'
        ? 'StringLiteral'
        : enumMembersType === 'NumberTypeAnnotation'
        ? 'NumericLiteral'
        : null;
    typeAnnotation.members.forEach(member => {
      var _member$initializer$t, _member$initializer;
      if (
        ((_member$initializer$t =
          (_member$initializer = member.initializer) === null ||
          _member$initializer === void 0
            ? void 0
            : _member$initializer.type) !== null &&
        _member$initializer$t !== void 0
          ? _member$initializer$t
          : 'StringLiteral') !== enumInitializerType
      ) {
        throw new Error(
          'Enum values can not be mixed. They all must be either blank, number, or string values.',
        );
      }
    });
  }
  parseEnumMembers(typeAnnotation) {
    return typeAnnotation.members.map(member => {
      var _member$initializer$v, _member$initializer2;
      return {
        name: member.id.name,
        value:
          (_member$initializer$v =
            (_member$initializer2 = member.initializer) === null ||
            _member$initializer2 === void 0
              ? void 0
              : _member$initializer2.value) !== null &&
          _member$initializer$v !== void 0
            ? _member$initializer$v
            : member.id.name,
      };
    });
  }
  isModuleInterface(node) {
    var _node$extends;
    return (
      node.type === 'TSInterfaceDeclaration' &&
      ((_node$extends = node.extends) === null || _node$extends === void 0
        ? void 0
        : _node$extends.length) === 1 &&
      node.extends[0].type === 'TSExpressionWithTypeArguments' &&
      node.extends[0].expression.name === 'TurboModule'
    );
  }
  extractAnnotatedElement(typeAnnotation, types) {
    return types[typeAnnotation.typeParameters.params[0].typeName.name];
  }

  /**
   * TODO(T108222691): Use flow-types for @babel/parser
   */
  getTypes(ast) {
    return ast.body.reduce((types, node) => {
      switch (node.type) {
        case 'ExportNamedDeclaration': {
          if (node.declaration) {
            switch (node.declaration.type) {
              case 'TSTypeAliasDeclaration':
              case 'TSInterfaceDeclaration':
              case 'TSEnumDeclaration': {
                types[node.declaration.id.name] = node.declaration;
                break;
              }
            }
          }
          break;
        }
        case 'TSTypeAliasDeclaration':
        case 'TSInterfaceDeclaration':
        case 'TSEnumDeclaration': {
          types[node.id.name] = node;
          break;
        }
      }
      return types;
    }, {});
  }
  callExpressionTypeParameters(callExpression) {
    return callExpression.typeParameters || null;
  }
  computePartialProperties(
    properties,
    hasteModuleName,
    types,
    aliasMap,
    enumMap,
    tryParse,
    cxxOnly,
  ) {
    return properties.map(prop => {
      return {
        name: prop.key.name,
        optional: true,
        typeAnnotation: typeScriptTranslateTypeAnnotation(
          hasteModuleName,
          prop.typeAnnotation.typeAnnotation,
          types,
          aliasMap,
          enumMap,
          tryParse,
          cxxOnly,
          this,
        ),
      };
    });
  }
  functionTypeAnnotation(propertyValueType) {
    return (
      propertyValueType === 'TSFunctionType' ||
      propertyValueType === 'TSMethodSignature'
    );
  }
  getTypeArgumentParamsFromDeclaration(declaration) {
    return declaration.typeParameters.params;
  }

  // This FlowFixMe is supposed to refer to typeArgumentParams and funcArgumentParams of generated AST.
  getNativeComponentType(typeArgumentParams, funcArgumentParams) {
    return {
      propsTypeName: typeArgumentParams[0].typeName.name,
      componentName: funcArgumentParams[0].value,
    };
  }
  getAnnotatedElementProperties(annotatedElement) {
    return annotatedElement.typeAnnotation.members;
  }
}
module.exports = {
  TypeScriptParser,
};
