'use strict';

const {
  findComponentConfig,
  getCommandProperties,
  getOptions
} = require('../../parsers-commons');
const {
  getCommands
} = require('./commands');
const {
  getEvents
} = require('./events');
function buildComponentSchema(ast, parser) {
  const {
    componentName,
    propsTypeName,
    optionsExpression
  } = findComponentConfig(ast, parser);
  const types = parser.getTypes(ast);
  const propProperties = parser.getProperties(propsTypeName, types);
  const commandProperties = getCommandProperties(ast, parser);
  const {
    extendsProps,
    props
  } = parser.getProps(propProperties, types);
  const options = getOptions(optionsExpression);
  const events = getEvents(propProperties, types, parser);
  const commands = getCommands(commandProperties, types, parser);
  return {
    filename: componentName,
    componentName,
    options,
    extendsProps,
    events,
    props,
    commands
  };
}
module.exports = {
  buildComponentSchema
};