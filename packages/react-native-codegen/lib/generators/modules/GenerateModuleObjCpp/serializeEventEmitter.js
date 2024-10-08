/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

const _require = require('../../Utils'),
  toPascalCase = _require.toPascalCase;
function getEventEmitterTypeObjCType(eventEmitter) {
  switch (eventEmitter.typeAnnotation.typeAnnotation.type) {
    case 'StringTypeAnnotation':
      return 'NSString *_Nonnull';
    case 'NumberTypeAnnotation':
      return 'NSNumber *_Nonnull';
    case 'BooleanTypeAnnotation':
      return 'BOOL';
    case 'GenericObjectTypeAnnotation':
    case 'ObjectTypeAnnotation':
    case 'TypeAliasTypeAnnotation':
      return 'NSDictionary *';
    case 'ArrayTypeAnnotation':
      return 'NSArray<id<NSObject>> *';
    default:
      throw new Error(
        `Unsupported eventType for ${eventEmitter.name}. Found: ${eventEmitter.typeAnnotation.typeAnnotation.type}`,
      );
  }
}
function EventEmitterHeaderTemplate(eventEmitter) {
  return `- (void)emit${toPascalCase(eventEmitter.name)}${
    eventEmitter.typeAnnotation.typeAnnotation.type !== 'VoidTypeAnnotation'
      ? `:(${getEventEmitterTypeObjCType(eventEmitter)})value`
      : ''
  };`;
}
function EventEmitterImplementationTemplate(eventEmitter) {
  return `- (void)emit${toPascalCase(eventEmitter.name)}${
    eventEmitter.typeAnnotation.typeAnnotation.type !== 'VoidTypeAnnotation'
      ? `:(${getEventEmitterTypeObjCType(eventEmitter)})value`
      : ''
  }
{
  _eventEmitterCallback("${eventEmitter.name}", ${
    eventEmitter.typeAnnotation.typeAnnotation.type !== 'VoidTypeAnnotation'
      ? eventEmitter.typeAnnotation.typeAnnotation.type !==
        'BooleanTypeAnnotation'
        ? 'value'
        : '[NSNumber numberWithBool:value]'
      : 'nil'
  });
}`;
}
module.exports = {
  EventEmitterHeaderTemplate,
  EventEmitterImplementationTemplate,
};
