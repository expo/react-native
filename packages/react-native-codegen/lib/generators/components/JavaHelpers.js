'use strict';

const {
  getJavaImportsForReservedPrimitive
} = require('../ReservedPrimitiveTypes');
const {
  toSafeIdentifier
} = require('../Utils');
function getInterfaceJavaClassName(componentName) {
  return `${componentName.replace(/^RCT/, '')}ManagerInterface`;
}
function getDelegateJavaClassName(componentName) {
  return `${componentName.replace(/^RCT/, '')}ManagerDelegate`;
}
function toSafeJavaString(input, shouldUpperCaseFirst) {
  return toSafeIdentifier(input, shouldUpperCaseFirst !== false);
}
function getImports(component, type) {
  const imports = new Set();
  if (type === 'interface') {
    imports.add('import com.facebook.react.uimanager.ViewManagerWithGeneratedInterface;');
  }
  component.extendsProps.forEach(extendProps => {
    switch (extendProps.type) {
      case 'ReactNativeBuiltInType':
        switch (extendProps.knownTypeName) {
          case 'ReactNativeCoreViewProps':
            imports.add('import android.view.View;');
            return;
          default:
            extendProps.knownTypeName;
            throw new Error('Invalid knownTypeName');
        }
      default:
        extendProps.type;
        throw new Error('Invalid extended type');
    }
  });
  function addImportsForNativeName(name) {
    for (const javaImport of getJavaImportsForReservedPrimitive(name, type)) {
      imports.add(javaImport);
    }
  }
  component.props.forEach(prop => {
    const typeAnnotation = prop.typeAnnotation;
    if (typeAnnotation.type === 'ReservedPropTypeAnnotation') {
      addImportsForNativeName(typeAnnotation.name);
    }
    if (typeAnnotation.type === 'ArrayTypeAnnotation') {
      imports.add('import com.facebook.react.bridge.ReadableArray;');
    }
    if (typeAnnotation.type === 'ObjectTypeAnnotation') {
      imports.add('import com.facebook.react.bridge.ReadableMap;');
    }
    if (typeAnnotation.type === 'MixedTypeAnnotation') {
      if (type === 'delegate') {
        imports.add('import com.facebook.react.bridge.DynamicFromObject;');
      } else {
        imports.add('import com.facebook.react.bridge.Dynamic;');
      }
    }
  });
  component.commands.forEach(command => {
    command.typeAnnotation.params.forEach(param => {
      const cmdParamType = param.typeAnnotation.type;
      if (cmdParamType === 'ArrayTypeAnnotation') {
        imports.add('import com.facebook.react.bridge.ReadableArray;');
      }
    });
  });
  return imports;
}
module.exports = {
  getInterfaceJavaClassName,
  getDelegateJavaClassName,
  toSafeJavaString,
  getImports
};