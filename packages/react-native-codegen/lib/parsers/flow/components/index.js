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

const _require = require('./commands'),
  getCommands = _require.getCommands;
const _require2 = require('./events'),
  getEvents = _require2.getEvents;
const _require3 = require('./extends'),
  getExtendsProps = _require3.getExtendsProps,
  removeKnownExtends = _require3.removeKnownExtends;
const _require4 = require('./props'),
  getProps = _require4.getProps;
const _require5 = require('./componentsUtils.js'),
  getProperties = _require5.getProperties;
const _require6 = require('../../error-utils'),
  throwIfMoreThanOneCodegenNativecommands =
    _require6.throwIfMoreThanOneCodegenNativecommands;
const _require7 = require('../../parsers-commons'),
  createComponentConfig = _require7.createComponentConfig,
  findNativeComponentType = _require7.findNativeComponentType,
  getCommandOptions = _require7.getCommandOptions,
  getOptions = _require7.getOptions;

// $FlowFixMe[signature-verification-failure] there's no flowtype for AST
function findComponentConfig(ast, parser) {
  const foundConfigs = [];
  const defaultExports = ast.body.filter(
    node => node.type === 'ExportDefaultDeclaration',
  );
  defaultExports.forEach(statement => {
    findNativeComponentType(statement, foundConfigs, parser);
  });
  if (foundConfigs.length === 0) {
    throw new Error('Could not find component config for native component');
  }
  if (foundConfigs.length > 1) {
    throw new Error('Only one component is supported per file');
  }
  const foundConfig = foundConfigs[0];
  const namedExports = ast.body.filter(
    node => node.type === 'ExportNamedDeclaration',
  );
  const commandsTypeNames = namedExports
    .map(statement => {
      let callExpression;
      let calleeName;
      try {
        callExpression = statement.declaration.declarations[0].init;
        calleeName = callExpression.callee.name;
      } catch (e) {
        return;
      }
      if (calleeName !== 'codegenNativeCommands') {
        return;
      }

      // const statement.declaration.declarations[0].init
      if (callExpression.arguments.length !== 1) {
        throw new Error(
          'codegenNativeCommands must be passed options including the supported commands',
        );
      }
      const typeArgumentParam = callExpression.typeArguments.params[0];
      if (typeArgumentParam.type !== 'GenericTypeAnnotation') {
        throw new Error(
          "codegenNativeCommands doesn't support inline definitions. Specify a file local type alias",
        );
      }
      return {
        commandTypeName: typeArgumentParam.id.name,
        commandOptionsExpression: callExpression.arguments[0],
      };
    })
    .filter(Boolean);
  throwIfMoreThanOneCodegenNativecommands(commandsTypeNames);
  return createComponentConfig(foundConfig, commandsTypeNames);
}
function getCommandProperties(
  /* $FlowFixMe[missing-local-annot] The type annotation(s) required by Flow's
   * LTI update could not be added via codemod */
  commandTypeName,
  types,
  commandOptions,
) {
  if (commandTypeName == null) {
    return [];
  }
  const typeAlias = types[commandTypeName];
  if (typeAlias.type !== 'InterfaceDeclaration') {
    throw new Error(
      `The type argument for codegenNativeCommands must be an interface, received ${typeAlias.type}`,
    );
  }
  let properties;
  try {
    properties = typeAlias.body.properties;
  } catch (e) {
    throw new Error(
      `Failed to find type definition for "${commandTypeName}", please check that you have a valid codegen flow file`,
    );
  }
  const flowPropertyNames = properties
    .map(property => property && property.key && property.key.name)
    .filter(Boolean);
  if (commandOptions == null || commandOptions.supportedCommands == null) {
    throw new Error(
      'codegenNativeCommands must be given an options object with supportedCommands array',
    );
  }
  if (
    commandOptions.supportedCommands.length !== flowPropertyNames.length ||
    !commandOptions.supportedCommands.every(supportedCommand =>
      flowPropertyNames.includes(supportedCommand),
    )
  ) {
    throw new Error(
      `codegenNativeCommands expected the same supportedCommands specified in the ${commandTypeName} interface: ${flowPropertyNames.join(
        ', ',
      )}`,
    );
  }
  return properties;
}

// $FlowFixMe[signature-verification-failure] there's no flowtype for AST
function buildComponentSchema(ast, parser) {
  const _findComponentConfig = findComponentConfig(ast, parser),
    componentName = _findComponentConfig.componentName,
    propsTypeName = _findComponentConfig.propsTypeName,
    commandTypeName = _findComponentConfig.commandTypeName,
    commandOptionsExpression = _findComponentConfig.commandOptionsExpression,
    optionsExpression = _findComponentConfig.optionsExpression;
  const types = parser.getTypes(ast);
  const propProperties = getProperties(propsTypeName, types);
  const commandOptions = getCommandOptions(commandOptionsExpression);
  const commandProperties = getCommandProperties(
    commandTypeName,
    types,
    commandOptions,
  );
  const extendsProps = getExtendsProps(propProperties, types);
  const options = getOptions(optionsExpression);
  const nonExtendsProps = removeKnownExtends(propProperties, types);
  const props = getProps(nonExtendsProps, types);
  const events = getEvents(propProperties, types);
  const commands = getCommands(commandProperties, types);
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
