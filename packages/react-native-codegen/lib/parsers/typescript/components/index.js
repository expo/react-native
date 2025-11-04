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

const {
  findComponentConfig,
  getCommandProperties,
  getOptions,
} = require('../../parsers-commons');
const {getCommands} = require('./commands');
const {getEvents} = require('./events');
const {categorizeProps} = require('./extends');

// $FlowFixMe[unclear-type] TODO(T108222691): Use flow-types for @babel/parser

// $FlowFixMe[signature-verification-failure] TODO(T108222691): Use flow-types for @babel/parser
function buildComponentSchema(ast, parser) {
  const {componentName, propsTypeName, optionsExpression} = findComponentConfig(
    ast,
    parser,
  );
  const types = parser.getTypes(ast);
  const propProperties = parser.getProperties(propsTypeName, types);
  const commandProperties = getCommandProperties(ast, parser);
  const options = getOptions(optionsExpression);
  const componentEventAsts = [];
  categorizeProps(propProperties, types, componentEventAsts, parser);
  const {props, extendsProps} = parser.getProps(propProperties, types);
  const events = getEvents(componentEventAsts, types, parser);
  const commands = getCommands(commandProperties, types, parser);
  return {
    filename: componentName,
    componentName,
    options,
    extendsProps,
    events,
    props,
    commands,
  };
}
module.exports = {
  buildComponentSchema,
};
