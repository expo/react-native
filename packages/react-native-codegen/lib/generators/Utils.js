'use strict';

function capitalize(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
function indent(nice, spaces) {
  return nice.split('\n').map((line, index) => {
    if (line.length === 0 || index === 0) {
      return line;
    }
    const emptySpaces = new Array(spaces + 1).join(' ');
    return emptySpaces + line;
  }).join('\n');
}
function toPascalCase(inString) {
  if (inString.length === 0) {
    return inString;
  }
  return capitalize(inString);
}
function toSafeIdentifier(input, shouldCapitalize) {
  const parts = input.split('-');
  if (!shouldCapitalize) {
    return parts.join('');
  }
  return parts.map(toPascalCase).join('');
}
function toSafeCppString(input) {
  return toSafeIdentifier(input, true);
}
function getEnumName(moduleName, origEnumName) {
  const uppercasedPropName = toSafeCppString(origEnumName);
  return `${moduleName}${uppercasedPropName}`;
}
const NumberTypes = ['NumberTypeAnnotation', 'NumberLiteralTypeAnnotation'];
const StringTypes = ['StringTypeAnnotation', 'StringLiteralTypeAnnotation'];
const ObjectTypes = ['ObjectTypeAnnotation'];
const BooleanTypes = ['BooleanTypeAnnotation', 'BooleanLiteralTypeAnnotation'];
const ValidUnionTypes = [...NumberTypes, ...ObjectTypes, ...StringTypes, ...BooleanTypes];
class HeterogeneousUnionError extends Error {
  constructor() {
    super(`Non-homogenous union member types`);
  }
}
function parseValidUnionType(annotation) {
  const isUnionOfType = types => {
    return annotation.types.every(memberTypeAnnotation => types.includes(memberTypeAnnotation.type));
  };
  if (isUnionOfType(BooleanTypes)) {
    return 'boolean';
  }
  if (isUnionOfType(NumberTypes)) {
    return 'number';
  }
  if (isUnionOfType(ObjectTypes)) {
    return 'object';
  }
  if (isUnionOfType(StringTypes)) {
    return 'string';
  }
  const invalidTypes = annotation.types.filter(member => {
    return !ValidUnionTypes.includes(member.type);
  });
  if (invalidTypes.length === 0) {
    throw new HeterogeneousUnionError();
  } else {
    throw new Error(`Unsupported union member types: ${invalidTypes.join(', ')}"`);
  }
}
module.exports = {
  capitalize,
  indent,
  parseValidUnionType,
  toPascalCase,
  toSafeIdentifier,
  toSafeCppString,
  getEnumName,
  HeterogeneousUnionError
};