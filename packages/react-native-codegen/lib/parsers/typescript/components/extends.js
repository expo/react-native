'use strict';

const {
  parseTopLevelType
} = require('../parseTopLevelType');
function isEvent(typeAnnotation, parser) {
  if (typeAnnotation.type !== 'TSTypeReference') {
    return false;
  }
  const eventNames = new Set(['BubblingEventHandler', 'DirectEventHandler']);
  return eventNames.has(parser.getTypeAnnotationName(typeAnnotation));
}
function categorizeProps(typeDefinition, types, events, parser) {
  for (const prop of typeDefinition) {
    if (prop.type === 'TSPropertySignature') {
      const topLevelType = parseTopLevelType(prop.typeAnnotation.typeAnnotation, parser, types);
      if (isEvent(topLevelType.type, parser)) {
        events.push(prop);
      }
    }
  }
}
module.exports = {
  categorizeProps
};