'use strict';

const {
  capitalize
} = require('../../Utils');
const PojoCollector = require('./PojoCollector');
const {
  serializePojo
} = require('./serializePojo');
module.exports = {
  generate(libraryName, schema, packageName) {
    const pojoCollector = new PojoCollector();
    const basePackageName = 'com.facebook.react.viewmanagers';
    Object.keys(schema.modules).forEach(hasteModuleName => {
      const module = schema.modules[hasteModuleName];
      if (module.type !== 'Component') {
        return;
      }
      const {
        components
      } = module;
      if (components == null) {
        return null;
      }
      Object.keys(components).filter(componentName => {
        const component = components[componentName];
        return !(component.excludedPlatforms && component.excludedPlatforms.includes('android'));
      }).forEach(componentName => {
        const component = components[componentName];
        if (component == null) {
          return;
        }
        const {
          props
        } = component;
        pojoCollector.process(capitalize(hasteModuleName), `${capitalize(componentName)}Props`, {
          type: 'ObjectTypeAnnotation',
          properties: props
        });
      });
    });
    const pojoDir = basePackageName.split('.').join('/');
    return new Map(pojoCollector.getAllPojos().map(pojo => {
      return [`java/${pojoDir}/${pojo.namespace}/${pojo.name}.java`, serializePojo(pojo, basePackageName)];
    }));
  }
};