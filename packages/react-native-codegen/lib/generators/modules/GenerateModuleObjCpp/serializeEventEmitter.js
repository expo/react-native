const {
  parseValidUnionType,
  toPascalCase
} = require('../../Utils');
function getEventEmitterTypeObjCType(eventEmitter) {
  const typeAnnotation = eventEmitter.typeAnnotation.typeAnnotation;
  switch (typeAnnotation.type) {
    case 'StringTypeAnnotation':
      return 'NSString *_Nonnull';
    case 'StringLiteralTypeAnnotation':
      return 'NSString *_Nonnull';
    case 'UnionTypeAnnotation':
      const validUnionType = parseValidUnionType(typeAnnotation);
      switch (validUnionType) {
        case 'boolean':
          return 'BOOL';
        case 'number':
          return 'NSNumber *_Nonnull';
        case 'object':
          return 'NSDictionary *';
        case 'string':
          return 'NSString *_Nonnull';
        default:
          validUnionType;
          throw new Error(`Unsupported union member type`);
      }
    case 'NumberTypeAnnotation':
    case 'NumberLiteralTypeAnnotation':
      return 'NSNumber *_Nonnull';
    case 'BooleanTypeAnnotation':
    case 'BooleanLiteralTypeAnnotation':
      return 'BOOL';
    case 'GenericObjectTypeAnnotation':
    case 'ObjectTypeAnnotation':
    case 'TypeAliasTypeAnnotation':
      return 'NSDictionary *';
    case 'ArrayTypeAnnotation':
      return 'NSArray<id<NSObject>> *';
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
    case 'Int32TypeAnnotation':
    case 'VoidTypeAnnotation':
      throw new Error(`Unsupported eventType for ${eventEmitter.name}. Found: ${eventEmitter.typeAnnotation.typeAnnotation.type}`);
    default:
      typeAnnotation.type;
      throw new Error(`Unsupported eventType for ${eventEmitter.name}. Found: ${eventEmitter.typeAnnotation.typeAnnotation.type}`);
  }
}
function EventEmitterHeaderTemplate(eventEmitter) {
  return `- (void)emit${toPascalCase(eventEmitter.name)}${eventEmitter.typeAnnotation.typeAnnotation.type !== 'VoidTypeAnnotation' ? `:(${getEventEmitterTypeObjCType(eventEmitter)})value` : ''};`;
}
function EventEmitterImplementationTemplate(eventEmitter) {
  return `- (void)emit${toPascalCase(eventEmitter.name)}${eventEmitter.typeAnnotation.typeAnnotation.type !== 'VoidTypeAnnotation' ? `:(${getEventEmitterTypeObjCType(eventEmitter)})value` : ''}
{
  _eventEmitterCallback("${eventEmitter.name}", ${eventEmitter.typeAnnotation.typeAnnotation.type !== 'VoidTypeAnnotation' ? eventEmitter.typeAnnotation.typeAnnotation.type !== 'BooleanTypeAnnotation' ? 'value' : '[NSNumber numberWithBool:value]' : 'nil'});
}`;
}
module.exports = {
  EventEmitterHeaderTemplate,
  EventEmitterImplementationTemplate
};