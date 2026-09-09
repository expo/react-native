'use strict';

const {
  unwrapNullable
} = require('../../parsers/parsers-commons');
const invariant = require('invariant');
function createAliasResolver(aliasMap) {
  return aliasName => {
    const alias = aliasMap[aliasName];
    invariant(alias != null, `Unable to resolve type alias '${aliasName}'.`);
    return alias;
  };
}
function getModules(schema) {
  return Object.keys(schema.modules).reduce((modules, hasteModuleName) => {
    const module = schema.modules[hasteModuleName];
    if (module == null || module.type === 'Component') {
      return modules;
    }
    modules[hasteModuleName] = module;
    return modules;
  }, {});
}
function isDirectRecursiveMember(parentObjectAliasName, nullableTypeAnnotation) {
  const [typeAnnotation] = unwrapNullable(nullableTypeAnnotation);
  return parentObjectAliasName !== undefined && typeAnnotation.name === parentObjectAliasName;
}
function isArrayRecursiveMember(parentObjectAliasName, nullableTypeAnnotation) {
  var _typeAnnotation$eleme;
  const [typeAnnotation] = unwrapNullable(nullableTypeAnnotation);
  return parentObjectAliasName !== undefined && typeAnnotation.type === 'ArrayTypeAnnotation' && ((_typeAnnotation$eleme = typeAnnotation.elementType) === null || _typeAnnotation$eleme === void 0 ? void 0 : _typeAnnotation$eleme.name) === parentObjectAliasName;
}
function throwIfUnsupportedPromiseArrayBuffer(methodName, nullableReturnTypeAnnotation) {
  const [returnTypeAnnotation] = unwrapNullable(nullableReturnTypeAnnotation);
  if (returnTypeAnnotation.type !== 'PromiseTypeAnnotation') {
    return;
  }
  let elementType = returnTypeAnnotation.elementType;
  if (elementType.type === 'NullableTypeAnnotation') {
    elementType = elementType.typeAnnotation;
  }
  if (elementType.type === 'ArrayBufferTypeAnnotation') {
    throw new Error(`Unsupported return type for method "${methodName}": Promise<ArrayBuffer> is not ` + 'supported for Android (Java/Kotlin) or iOS (ObjC) TurboModules. Use a C++ ' + '(Cxx) TurboModule, return the ArrayBuffer from a synchronous method, or resolve ' + 'the Promise with a different type. ArrayBuffer is still supported as a method ' + 'argument and as a synchronous return value on all platforms.');
  }
}
function throwIfUnsupportedEventEmitterPayload(eventEmitterName, typeAnnotation) {
  if (typeAnnotation.type === 'ArrayBufferTypeAnnotation') {
    throw new Error(`Unsupported eventType for ${eventEmitterName}. Found: ${typeAnnotation.type}. ` + 'ArrayBuffer is not supported as an EventEmitter payload on any platform. ' + 'Pass the ArrayBuffer through a method instead.');
  }
}
module.exports = {
  createAliasResolver,
  getModules,
  isDirectRecursiveMember,
  isArrayRecursiveMember,
  throwIfUnsupportedEventEmitterPayload,
  throwIfUnsupportedPromiseArrayBuffer
};