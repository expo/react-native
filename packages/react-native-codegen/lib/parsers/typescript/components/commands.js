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
  parseTopLevelType = _require.parseTopLevelType;
const _require2 = require('./componentsUtils'),
  getPrimitiveTypeAnnotation = _require2.getPrimitiveTypeAnnotation;

// $FlowFixMe[unclear-type] there's no flowtype for ASTs

function buildCommandSchemaInternal(name, optional, parameters, types) {
  var _firstParam$typeAnnot, _firstParam$typeAnnot2;
  const firstParam = parameters[0].typeAnnotation;
  if (
    !(
      firstParam.typeAnnotation != null &&
      firstParam.typeAnnotation.type === 'TSTypeReference' &&
      ((_firstParam$typeAnnot = firstParam.typeAnnotation.typeName.left) ===
        null || _firstParam$typeAnnot === void 0
        ? void 0
        : _firstParam$typeAnnot.name) === 'React' &&
      ((_firstParam$typeAnnot2 = firstParam.typeAnnotation.typeName.right) ===
        null || _firstParam$typeAnnot2 === void 0
        ? void 0
        : _firstParam$typeAnnot2.name) === 'ElementRef'
    )
  ) {
    throw new Error(
      `The first argument of method ${name} must be of type React.ElementRef<>`,
    );
  }
  const params = parameters.slice(1).map(param => {
    const paramName = param.name;
    const paramValue = parseTopLevelType(
      param.typeAnnotation.typeAnnotation,
      types,
    ).type;
    const type =
      paramValue.type === 'TSTypeReference'
        ? paramValue.typeName.name
        : paramValue.type;
    let returnType;
    switch (type) {
      case 'RootTag':
        returnType = {
          type: 'ReservedTypeAnnotation',
          name: 'RootTag',
        };
        break;
      case 'TSBooleanKeyword':
      case 'Int32':
      case 'Double':
      case 'Float':
      case 'TSStringKeyword':
        returnType = getPrimitiveTypeAnnotation(type);
        break;
      case 'Array':
      case 'ReadOnlyArray':
        if (!paramValue.type === 'TSTypeReference') {
          throw new Error(
            'Array and ReadOnlyArray are TSTypeReference for array',
          );
        }
        returnType = {
          type: 'ArrayTypeAnnotation',
          elementType: getCommandArrayElementTypeType(
            paramValue.typeParameters.params[0],
          ),
        };
        break;
      case 'TSArrayType':
        returnType = {
          type: 'ArrayTypeAnnotation',
          elementType: getCommandArrayElementTypeType(paramValue.elementType),
        };
        break;
      default:
        type;
        throw new Error(
          `Unsupported param type for method "${name}", param "${paramName}". Found ${type}`,
        );
    }
    return {
      name: paramName,
      optional: false,
      typeAnnotation: returnType,
    };
  });
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'FunctionTypeAnnotation',
      params,
      returnTypeAnnotation: {
        type: 'VoidTypeAnnotation',
      },
    },
  };
}
function getCommandArrayElementTypeType(inputType) {
  // TODO: T172453752 support more complex type annotation for array element

  if (inputType == null || typeof inputType !== 'object') {
    throw new Error(`Expected an object, received ${typeof inputType}`);
  }
  const type = inputType.type;
  if (typeof type !== 'string') {
    throw new Error('Command array element type must be a string');
  }

  // This is not a great solution. This generally means its a type alias to another type
  // like an object or union. Ideally we'd encode that in the schema so the compat-check can
  // validate those deeper objects for breaking changes and the generators can do something smarter.
  // As of now, the generators just create ReadableMap or (const NSArray *) which are untyped
  if (type === 'TSTypeReference') {
    var _inputType$typeName;
    const name =
      typeof inputType.typeName === 'object'
        ? (_inputType$typeName = inputType.typeName) === null ||
          _inputType$typeName === void 0
          ? void 0
          : _inputType$typeName.name
        : null;
    if (typeof name !== 'string') {
      throw new Error('Expected TSTypeReference AST name to be a string');
    }
    try {
      return getPrimitiveTypeAnnotation(name);
    } catch (e) {
      return {
        type: 'MixedTypeAnnotation',
      };
    }
  }
  return getPrimitiveTypeAnnotation(type);
}
function buildCommandSchema(property, types) {
  if (property.type === 'TSPropertySignature') {
    const topLevelType = parseTopLevelType(
      property.typeAnnotation.typeAnnotation,
      types,
    );
    const name = property.key.name;
    const optional = property.optional || topLevelType.optional;
    const parameters = topLevelType.type.parameters || topLevelType.type.params;
    return buildCommandSchemaInternal(name, optional, parameters, types);
  } else {
    const name = property.key.name;
    const optional = property.optional || false;
    const parameters = property.parameters || property.params;
    return buildCommandSchemaInternal(name, optional, parameters, types);
  }
}
function getCommands(commandTypeAST, types) {
  return commandTypeAST
    .filter(
      property =>
        property.type === 'TSPropertySignature' ||
        property.type === 'TSMethodSignature',
    )
    .map(property => buildCommandSchema(property, types))
    .filter(Boolean);
}
module.exports = {
  getCommands,
};
