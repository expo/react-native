'use strict';

const {
  getCppLocalIncludesForReservedPrimitive,
  getCppTypeForReservedPrimitive
} = require('../ReservedPrimitiveTypes');
const {
  getEnumName
} = require('../Utils');
const {
  generateStructName,
  getCppTypeForAnnotation,
  getEnumMaskName,
  getImports
} = require('./CppHelpers.js');
function getNativeTypeFromAnnotation(componentName, prop, nameParts) {
  const typeAnnotation = prop.typeAnnotation;
  switch (typeAnnotation.type) {
    case 'BooleanTypeAnnotation':
    case 'StringTypeAnnotation':
    case 'Int32TypeAnnotation':
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
      return getCppTypeForAnnotation(typeAnnotation.type);
    case 'ReservedPropTypeAnnotation':
      return getCppTypeForReservedPrimitive(typeAnnotation.name);
    case 'ArrayTypeAnnotation':
      {
        const arrayType = typeAnnotation.elementType.type;
        if (arrayType === 'ArrayTypeAnnotation') {
          return `std::vector<${getNativeTypeFromAnnotation(componentName, {
            typeAnnotation: typeAnnotation.elementType,
            name: ''
          }, nameParts.concat([prop.name]))}>`;
        }
        if (arrayType === 'ObjectTypeAnnotation') {
          const structName = generateStructName(componentName, nameParts.concat([prop.name]));
          return `std::vector<${structName}>`;
        }
        if (arrayType === 'StringEnumTypeAnnotation') {
          const enumName = getEnumName(componentName, prop.name);
          return getEnumMaskName(enumName);
        }
        const itemAnnotation = getNativeTypeFromAnnotation(componentName, {
          typeAnnotation: typeAnnotation.elementType,
          name: componentName
        }, nameParts.concat([prop.name]));
        return `std::vector<${itemAnnotation}>`;
      }
    case 'ObjectTypeAnnotation':
      {
        return generateStructName(componentName, nameParts.concat([prop.name]));
      }
    case 'StringEnumTypeAnnotation':
      return getEnumName(componentName, prop.name);
    case 'Int32EnumTypeAnnotation':
      return getEnumName(componentName, prop.name);
    case 'MixedTypeAnnotation':
      return 'folly::dynamic';
    default:
      typeAnnotation;
      throw new Error(`Received invalid typeAnnotation for ${componentName} prop ${prop.name}, received ${typeAnnotation.type}`);
  }
}
function convertTypesToConstAddressIfNeeded(type, convertibleTypes) {
  if (convertibleTypes.has(type)) {
    return `${type} const &`;
  }
  return type;
}
function convertValueToSharedPointerWithMove(type, value, convertibleTypes) {
  if (convertibleTypes.has(type)) {
    return `std::make_shared<${type}>(std::move(${value}))`;
  }
  return value;
}
function convertVariableToSharedPointer(type, convertibleTypes) {
  if (convertibleTypes.has(type)) {
    return `std::shared_ptr<${type}>`;
  }
  return type;
}
function convertVariableToPointer(type, value, convertibleTypes) {
  if (convertibleTypes.has(type)) {
    return `*${value}`;
  }
  return value;
}
const CTOR_PARAM_ADDRESS_TYPES = new Set(['ImageSource']);
const SHARED_POINTER_TYPES = new Set(['ImageRequest']);
const convertCtorParamToAddressType = type => convertTypesToConstAddressIfNeeded(type, CTOR_PARAM_ADDRESS_TYPES);
const convertCtorInitToSharedPointers = (type, value) => convertValueToSharedPointerWithMove(type, value, SHARED_POINTER_TYPES);
const convertGettersReturnTypeToAddressType = type => convertTypesToConstAddressIfNeeded(type, SHARED_POINTER_TYPES);
const convertVarTypeToSharedPointer = type => convertVariableToSharedPointer(type, SHARED_POINTER_TYPES);
const convertVarValueToPointer = (type, value) => convertVariableToPointer(type, value, SHARED_POINTER_TYPES);
function getLocalImports(properties) {
  const imports = new Set();
  function addImportsForNativeName(name) {
    for (const include of getCppLocalIncludesForReservedPrimitive(name)) {
      imports.add(include);
    }
  }
  properties.forEach(prop => {
    const typeAnnotation = prop.typeAnnotation;
    if (typeAnnotation.type === 'ReservedPropTypeAnnotation') {
      addImportsForNativeName(typeAnnotation.name);
    }
    if (typeAnnotation.type === 'ArrayTypeAnnotation') {
      imports.add('#include <vector>');
      if (typeAnnotation.elementType.type === 'StringEnumTypeAnnotation') {
        imports.add('#include <cinttypes>');
      }
    }
    if (typeAnnotation.type === 'ArrayTypeAnnotation' && typeAnnotation.elementType.type === 'ReservedPropTypeAnnotation') {
      addImportsForNativeName(typeAnnotation.elementType.name);
    }
    if (typeAnnotation.type === 'ArrayTypeAnnotation' && typeAnnotation.elementType.type === 'ObjectTypeAnnotation') {
      imports.add('#include <react/renderer/core/propsConversions.h>');
      const objectProps = typeAnnotation.elementType.properties;
      const objectImports = getImports(objectProps);
      const localImports = getLocalImports(objectProps);
      objectImports.forEach(imports.add, imports);
      localImports.forEach(imports.add, imports);
    }
    if (typeAnnotation.type === 'ObjectTypeAnnotation') {
      imports.add('#include <react/renderer/core/propsConversions.h>');
      const objectImports = getImports(typeAnnotation.properties);
      const localImports = getLocalImports(typeAnnotation.properties);
      objectImports.forEach(imports.add, imports);
      localImports.forEach(imports.add, imports);
    }
  });
  return imports;
}
module.exports = {
  getNativeTypeFromAnnotation,
  convertCtorParamToAddressType,
  convertGettersReturnTypeToAddressType,
  convertCtorInitToSharedPointers,
  convertVarTypeToSharedPointer,
  convertVarValueToPointer,
  getLocalImports
};