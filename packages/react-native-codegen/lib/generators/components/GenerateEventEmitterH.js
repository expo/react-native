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

const _require = require('../Utils'),
  indent = _require.indent,
  toSafeCppString = _require.toSafeCppString;
const _require2 = require('./CppHelpers'),
  generateEventStructName = _require2.generateEventStructName,
  getCppArrayTypeForAnnotation = _require2.getCppArrayTypeForAnnotation,
  getCppTypeForAnnotation = _require2.getCppTypeForAnnotation,
  getImports = _require2.getImports;
const nullthrows = require('nullthrows');

// File path -> contents

const FileTemplate = ({componentEmitters, extraIncludes}) => `
/**
 * This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
 *
 * Do not edit this file as changes may cause incorrect behavior and will be lost
 * once the code is regenerated.
 *
 * ${'@'}generated by codegen project: GenerateEventEmitterH.js
 */
#pragma once

#include <react/renderer/components/view/ViewEventEmitter.h>
${[...extraIncludes].join('\n')}

namespace facebook::react {
${componentEmitters}
} // namespace facebook::react
`;
const ComponentTemplate = ({className, structs, events}) =>
  `
class ${className}EventEmitter : public ViewEventEmitter {
 public:
  using ViewEventEmitter::ViewEventEmitter;

  ${structs}
  ${events}
};
`.trim();
const StructTemplate = ({structName, fields}) =>
  `
  struct ${structName} {
    ${fields}
  };
`.trim();
const EnumTemplate = ({enumName, values, toCases}) =>
  `enum class ${enumName} {
  ${values}
};

static char const *toString(const ${enumName} value) {
  switch (value) {
    ${toCases}
  }
}
`.trim();
function getNativeTypeFromAnnotation(componentName, eventProperty, nameParts) {
  const type = eventProperty.typeAnnotation.type;
  switch (type) {
    case 'BooleanTypeAnnotation':
    case 'StringTypeAnnotation':
    case 'Int32TypeAnnotation':
    case 'DoubleTypeAnnotation':
    case 'FloatTypeAnnotation':
    case 'MixedTypeAnnotation':
      return getCppTypeForAnnotation(type);
    case 'StringEnumTypeAnnotation':
    case 'ObjectTypeAnnotation':
      return generateEventStructName([...nameParts, eventProperty.name]);
    case 'ArrayTypeAnnotation':
      const eventTypeAnnotation = eventProperty.typeAnnotation;
      if (eventTypeAnnotation.type !== 'ArrayTypeAnnotation') {
        throw new Error(
          "Inconsistent Codegen state: type was ArrayTypeAnnotation at the beginning of the body and now it isn't",
        );
      }
      return getCppArrayTypeForAnnotation(eventTypeAnnotation.elementType, [
        ...nameParts,
        eventProperty.name,
      ]);
    default:
      type;
      throw new Error(`Received invalid event property type ${type}`);
  }
}
function generateEnum(structs, options, nameParts) {
  const structName = generateEventStructName(nameParts);
  const fields = options
    .map((option, index) => `${toSafeCppString(option)}`)
    .join(',\n  ');
  const toCases = options
    .map(
      option =>
        `case ${structName}::${toSafeCppString(option)}: return "${option}";`,
    )
    .join('\n' + '    ');
  structs.set(
    structName,
    EnumTemplate({
      enumName: structName,
      values: fields,
      toCases: toCases,
    }),
  );
}
function handleGenerateStructForArray(
  structs,
  name,
  componentName,
  elementType,
  nameParts,
) {
  if (elementType.type === 'ObjectTypeAnnotation') {
    generateStruct(
      structs,
      componentName,
      nameParts.concat([name]),
      nullthrows(elementType.properties),
    );
  } else if (elementType.type === 'StringEnumTypeAnnotation') {
    generateEnum(structs, elementType.options, nameParts.concat([name]));
  } else if (elementType.type === 'ArrayTypeAnnotation') {
    handleGenerateStructForArray(
      structs,
      name,
      componentName,
      elementType.elementType,
      nameParts,
    );
  }
}
function generateStruct(structs, componentName, nameParts, properties) {
  const structNameParts = nameParts;
  const structName = generateEventStructName(structNameParts);
  const fields = properties
    .map(property => {
      return `${getNativeTypeFromAnnotation(
        componentName,
        property,
        structNameParts,
      )} ${property.name};`;
    })
    .join('\n' + '  ');
  properties.forEach(property => {
    const name = property.name,
      typeAnnotation = property.typeAnnotation;
    switch (typeAnnotation.type) {
      case 'BooleanTypeAnnotation':
      case 'StringTypeAnnotation':
      case 'Int32TypeAnnotation':
      case 'DoubleTypeAnnotation':
      case 'FloatTypeAnnotation':
      case 'MixedTypeAnnotation':
        return;
      case 'ArrayTypeAnnotation':
        handleGenerateStructForArray(
          structs,
          name,
          componentName,
          typeAnnotation.elementType,
          nameParts,
        );
        return;
      case 'ObjectTypeAnnotation':
        generateStruct(
          structs,
          componentName,
          nameParts.concat([name]),
          nullthrows(typeAnnotation.properties),
        );
        return;
      case 'StringEnumTypeAnnotation':
        generateEnum(structs, typeAnnotation.options, nameParts.concat([name]));
        return;
      default:
        typeAnnotation.type;
        throw new Error(
          `Received invalid event property type ${typeAnnotation.type}`,
        );
    }
  });
  structs.set(
    structName,
    StructTemplate({
      structName,
      fields,
    }),
  );
}
function generateStructs(componentName, component) {
  const structs = new Map();
  component.events.forEach(event => {
    if (event.typeAnnotation.argument) {
      generateStruct(
        structs,
        componentName,
        [event.name],
        event.typeAnnotation.argument.properties,
      );
    }
  });
  return Array.from(structs.values()).join('\n\n');
}
function generateEvent(componentName, event) {
  if (event.typeAnnotation.argument) {
    const structName = generateEventStructName([event.name]);
    return `void ${event.name}(${structName} value) const;`;
  }
  return `void ${event.name}() const;`;
}
function generateEvents(componentName, component) {
  return component.events
    .map(event => generateEvent(componentName, event))
    .join('\n\n' + '  ');
}
module.exports = {
  generate(
    libraryName,
    schema,
    packageName,
    assumeNonnull = false,
    headerPrefix,
  ) {
    const moduleComponents = Object.keys(schema.modules)
      .map(moduleName => {
        const module = schema.modules[moduleName];
        if (module.type !== 'Component') {
          return null;
        }
        const components = module.components;
        // No components in this module
        if (components == null) {
          return null;
        }
        return components;
      })
      .filter(Boolean)
      .reduce((acc, components) => Object.assign(acc, components), {});
    const extraIncludes = new Set();
    const componentEmitters = Object.keys(moduleComponents)
      .map(componentName => {
        const component = moduleComponents[componentName];
        component.events.forEach(event => {
          if (event.typeAnnotation.argument) {
            const argIncludes = getImports(
              event.typeAnnotation.argument.properties,
            );
            // $FlowFixMe[method-unbinding]
            argIncludes.forEach(extraIncludes.add, extraIncludes);
          }
        });
        const replacedTemplate = ComponentTemplate({
          className: componentName,
          structs: indent(generateStructs(componentName, component), 2),
          events: generateEvents(componentName, component),
        });
        return replacedTemplate;
      })
      .join('\n');
    const fileName = 'EventEmitters.h';
    const replacedTemplate = FileTemplate({
      componentEmitters,
      extraIncludes,
    });
    return new Map([[fileName, replacedTemplate]]);
  },
};
