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

const _require = require('./JavaHelpers'),
  getDelegateJavaClassName = _require.getDelegateJavaClassName,
  getImports = _require.getImports,
  getInterfaceJavaClassName = _require.getInterfaceJavaClassName,
  toSafeJavaString = _require.toSafeJavaString;

// File path -> contents

const FileTemplate = ({
  packageName,
  imports,
  className,
  extendClasses,
  interfaceClassName,
  methods,
}) => `/**
* This code was generated by [react-native-codegen](https://www.npmjs.com/package/react-native-codegen).
*
* Do not edit this file as changes may cause incorrect behavior and will be lost
* once the code is regenerated.
*
* ${'@'}generated by codegen project: GeneratePropsJavaDelegate.js
*/

package ${packageName};

${imports}

public class ${className}<T extends ${extendClasses}, U extends BaseViewManagerInterface<T> & ${interfaceClassName}<T>> extends BaseViewManagerDelegate<T, U> {
  public ${className}(U viewManager) {
    super(viewManager);
  }
  ${methods}
}
`;
const PropSetterTemplate = ({propCases}) =>
  `
  @Override
  public void setProperty(T view, String propName, @Nullable Object value) {
    ${propCases}
  }
`.trim();
const CommandsTemplate = ({commandCases}) =>
  `
  @Override
  public void receiveCommand(T view, String commandName, @Nullable ReadableArray args) {
    switch (commandName) {
      ${commandCases}
    }
  }
`.trim();
function getJavaValueForProp(prop, componentName) {
  const typeAnnotation = prop.typeAnnotation;
  switch (typeAnnotation.type) {
    case 'BooleanTypeAnnotation':
      if (typeAnnotation.default === null) {
        return 'value == null ? null : (Boolean) value';
      } else {
        return `value == null ? ${typeAnnotation.default.toString()} : (boolean) value`;
      }
    case 'StringTypeAnnotation':
      const defaultValueString =
        typeAnnotation.default === null
          ? 'null'
          : `"${typeAnnotation.default}"`;
      return `value == null ? ${defaultValueString} : (String) value`;
    case 'Int32TypeAnnotation':
      return `value == null ? ${typeAnnotation.default} : ((Double) value).intValue()`;
    case 'DoubleTypeAnnotation':
      if (prop.optional) {
        return `value == null ? ${typeAnnotation.default}f : ((Double) value).doubleValue()`;
      } else {
        return 'value == null ? Double.NaN : ((Double) value).doubleValue()';
      }
    case 'FloatTypeAnnotation':
      if (typeAnnotation.default === null) {
        return 'value == null ? null : ((Double) value).floatValue()';
      } else if (prop.optional) {
        return `value == null ? ${typeAnnotation.default}f : ((Double) value).floatValue()`;
      } else {
        return 'value == null ? Float.NaN : ((Double) value).floatValue()';
      }
    case 'ReservedPropTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'ColorPrimitive':
          return 'ColorPropConverter.getColor(value, view.getContext())';
        case 'ImageSourcePrimitive':
          return '(ReadableMap) value';
        case 'ImageRequestPrimitive':
          return '(ReadableMap) value';
        case 'PointPrimitive':
          return '(ReadableMap) value';
        case 'EdgeInsetsPrimitive':
          return '(ReadableMap) value';
        case 'DimensionPrimitive':
          return 'DimensionPropConverter.getDimension(value)';
        default:
          typeAnnotation.name;
          throw new Error('Received unknown ReservedPropTypeAnnotation');
      }
    case 'ArrayTypeAnnotation': {
      return '(ReadableArray) value';
    }
    case 'ObjectTypeAnnotation': {
      return '(ReadableMap) value';
    }
    case 'StringEnumTypeAnnotation':
      return '(String) value';
    case 'Int32EnumTypeAnnotation':
      return `value == null ? ${typeAnnotation.default} : ((Double) value).intValue()`;
    case 'MixedTypeAnnotation':
      return 'new DynamicFromObject(value)';
    default:
      typeAnnotation;
      throw new Error('Received invalid typeAnnotation');
  }
}
function generatePropCasesString(component, componentName) {
  if (component.props.length === 0) {
    return 'super.setProperty(view, propName, value);';
  }
  const cases = component.props
    .map(prop => {
      return `case "${prop.name}":
        mViewManager.set${toSafeJavaString(
          prop.name,
        )}(view, ${getJavaValueForProp(prop, componentName)});
        break;`;
    })
    .join('\n' + '      ');
  return `switch (propName) {
      ${cases}
      default:
        super.setProperty(view, propName, value);
    }`;
}
function getCommandArgJavaType(param, index) {
  const typeAnnotation = param.typeAnnotation;
  switch (typeAnnotation.type) {
    case 'ReservedTypeAnnotation':
      switch (typeAnnotation.name) {
        case 'RootTag':
          return `args.getDouble(${index})`;
        default:
          typeAnnotation.name;
          throw new Error(`Receieved invalid type: ${typeAnnotation.name}`);
      }
    case 'BooleanTypeAnnotation':
      return `args.getBoolean(${index})`;
    case 'DoubleTypeAnnotation':
      return `args.getDouble(${index})`;
    case 'FloatTypeAnnotation':
      return `(float) args.getDouble(${index})`;
    case 'Int32TypeAnnotation':
      return `args.getInt(${index})`;
    case 'StringTypeAnnotation':
      return `args.getString(${index})`;
    case 'ArrayTypeAnnotation':
      return `args.getArray(${index})`;
    default:
      typeAnnotation.type;
      throw new Error(`Receieved invalid type: ${typeAnnotation.type}`);
  }
}
function getCommandArguments(command) {
  return [
    'view',
    ...command.typeAnnotation.params.map(getCommandArgJavaType),
  ].join(', ');
}
function generateCommandCasesString(component, componentName) {
  if (component.commands.length === 0) {
    return null;
  }
  const commandMethods = component.commands
    .map(command => {
      return `case "${command.name}":
        mViewManager.${toSafeJavaString(
          command.name,
          false,
        )}(${getCommandArguments(command)});
        break;`;
    })
    .join('\n' + '      ');
  return commandMethods;
}
function getClassExtendString(component) {
  const extendString = component.extendsProps
    .map(extendProps => {
      switch (extendProps.type) {
        case 'ReactNativeBuiltInType':
          switch (extendProps.knownTypeName) {
            case 'ReactNativeCoreViewProps':
              return 'View';
            default:
              extendProps.knownTypeName;
              throw new Error('Invalid knownTypeName');
          }
        default:
          extendProps.type;
          throw new Error('Invalid extended type');
      }
    })
    .join('');
  return extendString;
}
function getDelegateImports(component) {
  const imports = getImports(component, 'delegate');
  // The delegate needs ReadableArray for commands always.
  // The interface doesn't always need it
  if (component.commands.length > 0) {
    imports.add('import com.facebook.react.bridge.ReadableArray;');
  }
  imports.add('import androidx.annotation.Nullable;');
  imports.add('import com.facebook.react.uimanager.BaseViewManagerDelegate;');
  imports.add('import com.facebook.react.uimanager.BaseViewManagerInterface;');
  return imports;
}
function generateMethods(propsString, commandsString) {
  return [
    PropSetterTemplate({
      propCases: propsString,
    }),
    commandsString != null
      ? CommandsTemplate({
          commandCases: commandsString,
        })
      : '',
  ]
    .join('\n\n  ')
    .trimRight();
}
module.exports = {
  generate(
    libraryName,
    schema,
    packageName,
    assumeNonnull = false,
    headerPrefix,
  ) {
    // TODO: This doesn't support custom package name yet.
    const normalizedPackageName = 'com.facebook.react.viewmanagers';
    const outputDir = `java/${normalizedPackageName.replace(/\./g, '/')}`;
    const files = new Map();
    Object.keys(schema.modules).forEach(moduleName => {
      const module = schema.modules[moduleName];
      if (module.type !== 'Component') {
        return;
      }
      const components = module.components;
      // No components in this module
      if (components == null) {
        return;
      }
      return Object.keys(components)
        .filter(componentName => {
          const component = components[componentName];
          return !(
            component.excludedPlatforms &&
            component.excludedPlatforms.includes('android')
          );
        })
        .forEach(componentName => {
          const component = components[componentName];
          const className = getDelegateJavaClassName(componentName);
          const interfaceClassName = getInterfaceJavaClassName(componentName);
          const imports = getDelegateImports(component);
          const propsString = generatePropCasesString(component, componentName);
          const commandsString = generateCommandCasesString(
            component,
            componentName,
          );
          const extendString = getClassExtendString(component);
          const replacedTemplate = FileTemplate({
            imports: Array.from(imports).sort().join('\n'),
            packageName: normalizedPackageName,
            className,
            extendClasses: extendString,
            methods: generateMethods(propsString, commandsString),
            interfaceClassName: interfaceClassName,
          });
          files.set(`${outputDir}/${className}.java`, replacedTemplate);
        });
    });
    return files;
  },
};
