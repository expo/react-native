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
  flowTranslateTypeAnnotation = _require.flowTranslateTypeAnnotation;

// $FlowFixMe[untyped-import] there's no flowtype flow-parser
const flowParser = require('flow-parser');
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
class FlowParser {
  constructor() {
    _defineProperty(
      this,
      'typeParameterInstantiation',
      'TypeParameterInstantiation',
    );
  }
  isProperty(property) {
    return property.type === 'ObjectTypeProperty';
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
    return 'Flow';
  }
  nameForGenericTypeAnnotation(typeAnnotation) {
    return typeAnnotation.id.name;
  }
  checkIfInvalidModule(typeArguments) {
    return (
      typeArguments.type !== 'TypeParameterInstantiation' ||
      typeArguments.params.length !== 1 ||
      typeArguments.params[0].type !== 'GenericTypeAnnotation' ||
      typeArguments.params[0].id.name !== 'Spec'
    );
  }
  remapUnionTypeAnnotationMemberNames(membersTypes) {
    const remapLiteral = item => {
      return item.type
        .replace('NumberLiteralTypeAnnotation', 'NumberTypeAnnotation')
        .replace('StringLiteralTypeAnnotation', 'StringTypeAnnotation');
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
      flowTranslateTypeAnnotation,
    );
  }
  parseModuleFixture(filename) {
    const contents = fs.readFileSync(filename, 'utf8');
    return this.parseString(contents, 'path/NativeSampleTurboModule.js');
  }
  getAst(contents) {
    return flowParser.parse(contents, {
      enums: true,
    });
  }
  getFunctionTypeAnnotationParameters(functionTypeAnnotation) {
    return functionTypeAnnotation.params;
  }
  getFunctionNameFromParameter(parameter) {
    return parameter.name;
  }
  getParameterName(parameter) {
    return parameter.name.name;
  }
  getParameterTypeAnnotation(parameter) {
    return parameter.typeAnnotation;
  }
  getFunctionTypeAnnotationReturnType(functionTypeAnnotation) {
    return functionTypeAnnotation.returnType;
  }
  parseEnumMembersType(typeAnnotation) {
    const enumMembersType =
      typeAnnotation.type === 'EnumStringBody'
        ? 'StringTypeAnnotation'
        : typeAnnotation.type === 'EnumNumberBody'
        ? 'NumberTypeAnnotation'
        : null;
    if (!enumMembersType) {
      throw new Error(
        `Unknown enum type annotation type. Got: ${typeAnnotation.type}. Expected: EnumStringBody or EnumNumberBody.`,
      );
    }
    return enumMembersType;
  }
  validateEnumMembersSupported(typeAnnotation, enumMembersType) {
    if (!typeAnnotation.members || typeAnnotation.members.length === 0) {
      // passing mixed members to flow would result in a flow error
      // if the tool is launched ignoring that error, the enum would appear like not having enums
      throw new Error(
        'Enums should have at least one member and member values can not be mixed- they all must be either blank, number, or string values.',
      );
    }
    typeAnnotation.members.forEach(member => {
      if (
        enumMembersType === 'StringTypeAnnotation' &&
        (!member.init || typeof member.init.value === 'string')
      ) {
        return;
      }
      if (
        enumMembersType === 'NumberTypeAnnotation' &&
        member.init &&
        typeof member.init.value === 'number'
      ) {
        return;
      }
      throw new Error(
        'Enums can not be mixed- they all must be either blank, number, or string values.',
      );
    });
  }
  parseEnumMembers(typeAnnotation) {
    return typeAnnotation.members.map(member => {
      var _member$init$value, _member$init;
      return {
        name: member.id.name,
        value:
          (_member$init$value =
            (_member$init = member.init) === null || _member$init === void 0
              ? void 0
              : _member$init.value) !== null && _member$init$value !== void 0
            ? _member$init$value
            : member.id.name,
      };
    });
  }
  isModuleInterface(node) {
    return (
      node.type === 'InterfaceDeclaration' &&
      node.extends.length === 1 &&
      node.extends[0].type === 'InterfaceExtends' &&
      node.extends[0].id.name === 'TurboModule'
    );
  }
  extractAnnotatedElement(typeAnnotation, types) {
    return types[typeAnnotation.typeParameters.params[0].id.name];
  }

  /**
   * This FlowFixMe is supposed to refer to an InterfaceDeclaration or TypeAlias
   * declaration type. Unfortunately, we don't have those types, because flow-parser
   * generates them, and flow-parser is not type-safe. In the future, we should find
   * a way to get these types from our flow parser library.
   *
   * TODO(T71778680): Flow type AST Nodes
   */

  getTypes(ast) {
    return ast.body.reduce((types, node) => {
      if (
        node.type === 'ExportNamedDeclaration' &&
        node.exportKind === 'type'
      ) {
        if (
          node.declaration != null &&
          (node.declaration.type === 'TypeAlias' ||
            node.declaration.type === 'InterfaceDeclaration')
        ) {
          types[node.declaration.id.name] = node.declaration;
        }
      } else if (
        node.type === 'ExportNamedDeclaration' &&
        node.exportKind === 'value' &&
        node.declaration &&
        node.declaration.type === 'EnumDeclaration'
      ) {
        types[node.declaration.id.name] = node.declaration;
      } else if (
        node.type === 'TypeAlias' ||
        node.type === 'InterfaceDeclaration' ||
        node.type === 'EnumDeclaration'
      ) {
        types[node.id.name] = node;
      }
      return types;
    }, {});
  }
  callExpressionTypeParameters(callExpression) {
    return callExpression.typeArguments || null;
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
        typeAnnotation: flowTranslateTypeAnnotation(
          hasteModuleName,
          prop.value,
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
    return propertyValueType === 'FunctionTypeAnnotation';
  }
  getTypeArgumentParamsFromDeclaration(declaration) {
    return declaration.typeArguments.params;
  }

  /**
   * This FlowFixMe is supposed to refer to typeArgumentParams and
   * funcArgumentParams of generated AST.
   */
  getNativeComponentType(typeArgumentParams, funcArgumentParams) {
    return {
      propsTypeName: typeArgumentParams[0].id.name,
      componentName: funcArgumentParams[0].value,
    };
  }
  getAnnotatedElementProperties(annotatedElement) {
    return annotatedElement.right.properties;
  }
}
module.exports = {
  FlowParser,
};
