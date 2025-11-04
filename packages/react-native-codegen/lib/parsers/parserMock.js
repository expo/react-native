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
import invariant from 'invariant';
const {
  UnsupportedObjectPropertyTypeAnnotationParserError,
} = require('./errors');
const {parseFlowAndThrowErrors} = require('./flow/parseFlowAndThrowErrors');
const {buildPropSchema} = require('./parsers-commons');
const {flattenProperties} = require('./typescript/components/componentsUtils');
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
    _defineProperty(this, 'typeAlias', 'TypeAlias');
    _defineProperty(this, 'enumDeclaration', 'EnumDeclaration');
    _defineProperty(this, 'interfaceDeclaration', 'InterfaceDeclaration');
    _defineProperty(
      this,
      'nullLiteralTypeAnnotation',
      'NullLiteralTypeAnnotation',
    );
    _defineProperty(
      this,
      'undefinedLiteralTypeAnnotation',
      'VoidLiteralTypeAnnotation',
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
  getTypeAnnotationName(typeAnnotation) {
    var _typeAnnotation$id;
    return typeAnnotation === null ||
      typeAnnotation === void 0 ||
      (_typeAnnotation$id = typeAnnotation.id) === null ||
      _typeAnnotation$id === void 0
      ? void 0
      : _typeAnnotation$id.name;
  }
  checkIfInvalidModule(typeArguments) {
    return false;
  }
  remapUnionTypeAnnotationMemberNames(membersTypes) {
    return [];
  }
  getStringLiteralUnionTypeAnnotationStringLiterals(membersTypes) {
    return [];
  }
  parseFile(filename) {
    /* $FlowFixMe[incompatible-type] Natural Inference rollout. See
     * https://fburl.com/workplace/6291gfvu */
    return schemaMock;
  }
  parseString(contents, filename) {
    /* $FlowFixMe[incompatible-type] Natural Inference rollout. See
     * https://fburl.com/workplace/6291gfvu */
    return schemaMock;
  }
  parseModuleFixture(filename) {
    /* $FlowFixMe[incompatible-type] Natural Inference rollout. See
     * https://fburl.com/workplace/6291gfvu */
    return schemaMock;
  }
  getAst(contents, filename) {
    return parseFlowAndThrowErrors(contents, {
      filename,
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
            value: {
              type: 'StringLiteralTypeAnnotation',
              value: 'hello',
            },
          },
          {
            name: 'Goodbye',
            value: {
              type: 'StringLiteralTypeAnnotation',
              value: 'goodbye',
            },
          },
        ]
      : [
          {
            name: 'On',
            value: {
              type: 'NumberLiteralTypeAnnotation',
              value: 1,
            },
          },
          {
            name: 'Off',
            value: {
              type: 'NumberLiteralTypeAnnotation',
              value: 0,
            },
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
  isGenericTypeAnnotation(type) {
    return true;
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
  bodyProperties(typeAlias) {
    return typeAlias.body.properties;
  }
  convertKeywordToTypeAnnotation(keyword) {
    return keyword;
  }
  argumentForProp(prop) {
    return prop.expression;
  }
  nameForArgument(prop) {
    return prop.expression.name;
  }
  isOptionalProperty(property) {
    return property.optional || false;
  }
  getTypeAnnotationFromProperty(property) {
    return property.typeAnnotation.typeAnnotation;
  }
  getGetTypeAnnotationFN() {
    return () => {
      return {};
    };
  }
  getGetSchemaInfoFN() {
    return () => {
      return {
        name: 'MockedSchema',
        optional: false,
        typeAnnotation: 'BooleanTypeAnnotation',
        defaultValue: false,
        withNullDefault: false,
      };
    };
  }
  getResolveTypeAnnotationFN() {
    return () => {
      return {
        nullable: false,
        typeAnnotation: null,
        typeResolutionStatus: {
          successful: false,
        },
      };
    };
  }
  getResolvedTypeAnnotation(typeAnnotation, types) {
    invariant(
      typeAnnotation != null,
      'resolveTypeAnnotation(): typeAnnotation cannot be null',
    );
    let node = typeAnnotation;
    let nullable = false;
    let typeResolutionStatus = {
      successful: false,
    };
    for (;;) {
      if (node.type === 'NullableTypeAnnotation') {
        nullable = true;
        node = node.typeAnnotation;
        continue;
      }
      if (node.type !== 'GenericTypeAnnotation') {
        break;
      }
      const resolvedTypeAnnotation = types[node.id.name];
      if (resolvedTypeAnnotation == null) {
        break;
      }
      switch (resolvedTypeAnnotation.type) {
        case 'TypeAlias': {
          typeResolutionStatus = {
            successful: true,
            type: 'alias',
            name: node.id.name,
          };
          node = resolvedTypeAnnotation.right;
          break;
        }
        case 'EnumDeclaration': {
          typeResolutionStatus = {
            successful: true,
            type: 'enum',
            name: node.id.name,
          };
          node = resolvedTypeAnnotation.body;
          break;
        }
        default: {
          throw new TypeError(
            `A non GenericTypeAnnotation must be a type declaration ('TypeAlias') or enum ('EnumDeclaration'). Instead, got the unsupported ${resolvedTypeAnnotation.type}.`,
          );
        }
      }
    }
    return {
      nullable: nullable,
      typeAnnotation: node,
      typeResolutionStatus,
    };
  }
  getExtendsProps(typeDefinition, types) {
    return typeDefinition
      .filter(prop => prop.type === 'ObjectTypeSpreadProperty')
      .map(prop => this.extendsForProp(prop, types, this))
      .filter(Boolean);
  }
  extendsForProp(prop, types, parser) {
    const argument = this.argumentForProp(prop);
    if (!argument) {
      console.log('null', prop);
    }
    const name = parser.nameForArgument(prop);
    if (types[name] != null) {
      // This type is locally defined in the file
      return null;
    }
    switch (name) {
      case 'ViewProps':
        return {
          type: 'ReactNativeBuiltInType',
          knownTypeName: 'ReactNativeCoreViewProps',
        };
      default: {
        throw new Error(`Unable to handle prop spread: ${name}`);
      }
    }
  }
  removeKnownExtends(typeDefinition, types) {
    return typeDefinition.filter(
      prop =>
        prop.type !== 'ObjectTypeSpreadProperty' ||
        this.extendsForProp(prop, types, this) === null,
    );
  }
  getProps(typeDefinition, types) {
    const nonExtendsProps = this.removeKnownExtends(typeDefinition, types);
    const props = flattenProperties(nonExtendsProps, types, this)
      .map(property => buildPropSchema(property, types, this))
      .filter(Boolean);
    return {
      props,
      extendsProps: this.getExtendsProps(typeDefinition, types),
    };
  }
  getProperties(typeName, types) {
    const typeAlias = types[typeName];
    try {
      return typeAlias.right.typeParameters.params[0].properties;
    } catch (e) {
      throw new Error(
        `Failed to find type definition for "${typeName}", please check that you have a valid codegen flow file`,
      );
    }
  }
  nextNodeForTypeAlias(typeAnnotation) {
    return typeAnnotation.right;
  }
  nextNodeForEnum(typeAnnotation) {
    return typeAnnotation.body;
  }
  genericTypeAnnotationErrorMessage(typeAnnotation) {
    return `A non GenericTypeAnnotation must be a type declaration ('${this.typeAlias}') or enum ('${this.enumDeclaration}'). Instead, got the unsupported ${typeAnnotation.type}.`;
  }
  extractTypeFromTypeAnnotation(typeAnnotation) {
    return typeAnnotation.type === 'GenericTypeAnnotation'
      ? typeAnnotation.id.name
      : typeAnnotation.type;
  }
  getObjectProperties(typeAnnotation) {
    return typeAnnotation.properties;
  }
  getLiteralValue(option) {
    return option.value;
  }
  getPaperTopLevelNameDeprecated(typeAnnotation) {
    return typeAnnotation.typeParameters.params.length > 1
      ? typeAnnotation.typeParameters.params[1].value
      : null;
  }
}
