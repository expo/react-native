'use strict';

const {
  parseTopLevelType
} = require('../parseTopLevelType');
const {
  getPrimitiveTypeAnnotation
} = require('./componentsUtils');
function buildCommandSchemaInternal(name, optional, parameters, types, parser) {
  var _firstParam$typeAnnot, _firstParam$typeAnnot2, _firstParam$typeAnnot3;
  const firstParam = parameters[0].typeAnnotation;
  if (!(firstParam.typeAnnotation != null && firstParam.typeAnnotation.type === 'TSTypeReference' && ((_firstParam$typeAnnot = firstParam.typeAnnotation.typeName.left) === null || _firstParam$typeAnnot === void 0 ? void 0 : _firstParam$typeAnnot.name) === 'React' && (((_firstParam$typeAnnot2 = firstParam.typeAnnotation.typeName.right) === null || _firstParam$typeAnnot2 === void 0 ? void 0 : _firstParam$typeAnnot2.name) === 'ElementRef' || ((_firstParam$typeAnnot3 = firstParam.typeAnnotation.typeName.right) === null || _firstParam$typeAnnot3 === void 0 ? void 0 : _firstParam$typeAnnot3.name) === 'ComponentRef'))) {
    throw new Error(`The first argument of method ${name} must be of type React.ElementRef<> or React.ComponentRef<>`);
  }
  const params = parameters.slice(1).map(param => {
    const paramName = param.name;
    const paramValue = parseTopLevelType(param.typeAnnotation.typeAnnotation, parser, types).type;
    const type = paramValue.type === 'TSTypeReference' ? parser.getTypeAnnotationName(paramValue) : paramValue.type;
    let returnType;
    switch (type) {
      case 'RootTag':
        returnType = {
          type: 'ReservedTypeAnnotation',
          name: 'RootTag'
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
          throw new Error('Array and ReadOnlyArray are TSTypeReference for array');
        }
        returnType = {
          type: 'ArrayTypeAnnotation',
          elementType: getCommandArrayElementTypeType(paramValue.typeParameters.params[0], parser)
        };
        break;
      case 'TSArrayType':
        returnType = {
          type: 'ArrayTypeAnnotation',
          elementType: getCommandArrayElementTypeType(paramValue.elementType, parser)
        };
        break;
      default:
        type;
        throw new Error(`Unsupported param type for method "${name}", param "${paramName}". Found ${type}`);
    }
    return {
      name: paramName,
      optional: false,
      typeAnnotation: returnType
    };
  });
  return {
    name,
    optional,
    typeAnnotation: {
      type: 'FunctionTypeAnnotation',
      params,
      returnTypeAnnotation: {
        type: 'VoidTypeAnnotation'
      }
    }
  };
}
function getCommandArrayElementTypeType(inputType, parser) {
  if (inputType == null || typeof inputType !== 'object') {
    throw new Error(`Expected an object, received ${typeof inputType}`);
  }
  const type = inputType.type;
  if (typeof type !== 'string') {
    throw new Error('Command array element type must be a string');
  }
  if (type === 'TSTypeReference') {
    const name = typeof inputType.typeName === 'object' ? parser.getTypeAnnotationName(inputType) : null;
    if (typeof name !== 'string') {
      throw new Error('Expected TSTypeReference AST name to be a string');
    }
    try {
      return getPrimitiveTypeAnnotation(name);
    } catch (e) {
      return {
        type: 'MixedTypeAnnotation'
      };
    }
  }
  return getPrimitiveTypeAnnotation(type);
}
function buildCommandSchema(property, types, parser) {
  if (property.type === 'TSPropertySignature') {
    const topLevelType = parseTopLevelType(property.typeAnnotation.typeAnnotation, parser, types);
    const name = property.key.name;
    const optional = property.optional || topLevelType.optional;
    const parameters = topLevelType.type.parameters || topLevelType.type.params;
    return buildCommandSchemaInternal(name, optional, parameters, types, parser);
  } else {
    const name = property.key.name;
    const optional = property.optional || false;
    const parameters = property.parameters || property.params;
    return buildCommandSchemaInternal(name, optional, parameters, types, parser);
  }
}
function getCommands(commandTypeAST, types, parser) {
  return commandTypeAST.filter(property => property.type === 'TSPropertySignature' || property.type === 'TSMethodSignature').map(property => buildCommandSchema(property, types, parser)).filter(Boolean);
}
module.exports = {
  getCommands
};