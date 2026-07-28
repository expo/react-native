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
const {
  categorizeProps
} = require('./extends');
function buildComponentSchema(ast, parser) {
  const {
    componentName,
    propsTypeName,
    optionsExpression
  } = findComponentConfig(ast, parser);
  const types = parser.getTypes(ast);
  const propProperties = parser.getProperties(propsTypeName, types);
  const commandProperties = getCommandProperties(ast, parser);
  const options = getOptions(optionsExpression);
  const componentEventAsts = [];
  categorizeProps(propProperties, types, componentEventAsts, parser);
  const {
    props,
    extendsProps
  } = parser.getProps(propProperties, types);
  const events = getEvents(componentEventAsts, types, parser);
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