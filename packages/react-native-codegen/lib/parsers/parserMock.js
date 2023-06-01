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
// $FlowFixMe[untyped-import] there's no flowtype flow-parser
const flowParser = require('flow-parser');
const _require = require('./errors'),
  UnsupportedObjectPropertyTypeAnnotationParserError =
    _require.UnsupportedObjectPropertyTypeAnnotationParserError;
const schemaMock = {
  modules: {
    StringPropNativeComponentView: {
      type: 'Component',
      components: {
        StringPropNativeComponentView: {
          extendsProps: [],
          events: [],
          props: [],
          commands: [],
        },
      },
    },
  },
};
export class MockedParser {
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
    return false;
  }
  remapUnionTypeAnnotationMemberNames(membersTypes) {
    return [];
  }
  parseFile(filename) {
    return schemaMock;
  }
  parseString(contents, filename) {
    return schemaMock;
  }
  parseModuleFixture(filename) {
    return schemaMock;
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
    return typeAnnotation.type;
  }
  validateEnumMembersSupported(typeAnnotation, enumMembersType) {
    return;
  }
  parseEnumMembers(typeAnnotation) {
    return typeAnnotation.type === 'StringTypeAnnotation'
      ? [
          {
            name: 'Hello',
            value: 'hello',
          },
          {
            name: 'Goodbye',
            value: 'goodbye',
          },
        ]
      : [
          {
            name: 'On',
            value: '1',
          },
          {
            name: 'Off',
            value: '0',
          },
        ];
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
  getTypes(ast) {
    return {};
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
    return [
      {
        name: 'a',
        optional: true,
        typeAnnotation: {
          type: 'StringTypeAnnotation',
        },
      },
      {
        name: 'b',
        optional: true,
        typeAnnotation: {
          type: 'BooleanTypeAnnotation',
        },
      },
    ];
  }
  functionTypeAnnotation(propertyValueType) {
    return propertyValueType === 'FunctionTypeAnnotation';
  }
  getTypeArgumentParamsFromDeclaration(declaration) {
    return declaration.typeArguments.params;
  }
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
