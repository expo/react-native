'use strict';

const {
  ParserError
} = require('./errors');
const path = require('path');
function extractNativeModuleName(filename) {
  return path.basename(filename).split('.')[0];
}
function createParserErrorCapturer() {
  const errors = [];
  function guard(fn) {
    try {
      return fn();
    } catch (error) {
      if (!(error instanceof ParserError)) {
        throw error;
      }
      errors.push(error);
      return null;
    }
  }
  return [errors, guard];
}
function verifyPlatforms(hasteModuleName, moduleName) {
  let cxxOnly = false;
  const excludedPlatforms = new Set();
  const namesToValidate = [moduleName, hasteModuleName];
  namesToValidate.forEach(name => {
    if (name.endsWith('Android')) {
      excludedPlatforms.add('iOS');
      return;
    }
    if (name.endsWith('IOS')) {
      excludedPlatforms.add('android');
      return;
    }
    if (name.endsWith('Windows')) {
      excludedPlatforms.add('iOS');
      excludedPlatforms.add('android');
      return;
    }
    if (name.endsWith('Cxx')) {
      cxxOnly = true;
      excludedPlatforms.add('iOS');
      excludedPlatforms.add('android');
      return;
    }
  });
  return {
    cxxOnly,
    excludedPlatforms: Array.from(excludedPlatforms)
  };
}
function visit(astNode, visitor) {
  const queue = [astNode];
  while (queue.length !== 0) {
    let item = queue.shift();
    if (!(typeof item === 'object' && item != null)) {
      continue;
    }
    if (typeof item.type === 'string' && typeof visitor[item.type] === 'function') {
      visitor[item.type](item);
    } else if (Array.isArray(item)) {
      queue.push(...item);
    } else {
      queue.push(...Object.values(item));
    }
  }
}
function getConfigType(ast, Visitor) {
  let infoMap = {
    isComponent: false,
    isModule: false
  };
  visit(ast, Visitor(infoMap));
  const {
    isModule,
    isComponent
  } = infoMap;
  if (isModule && isComponent) {
    throw new Error('Found type extending "TurboModule" and exported "codegenNativeComponent" declaration in one file. Split them into separated files.');
  }
  if (isModule) {
    return 'module';
  } else if (isComponent) {
    return 'component';
  } else {
    return 'none';
  }
}
function isModuleRegistryCall(node) {
  if (node.type !== 'CallExpression') {
    return false;
  }
  const callExpression = node;
  if (callExpression.callee.type !== 'MemberExpression') {
    return false;
  }
  const memberExpression = callExpression.callee;
  if (!(memberExpression.object.type === 'Identifier' && memberExpression.object.name === 'TurboModuleRegistry')) {
    return false;
  }
  if (!(memberExpression.property.type === 'Identifier' && (memberExpression.property.name === 'get' || memberExpression.property.name === 'getEnforcing'))) {
    return false;
  }
  if (memberExpression.computed) {
    return false;
  }
  return true;
}
function getSortedObject(unsortedObject) {
  return Object.keys(unsortedObject).sort().reduce((sortedObject, key) => {
    sortedObject[key] = unsortedObject[key];
    return sortedObject;
  }, {});
}
module.exports = {
  getConfigType,
  extractNativeModuleName,
  createParserErrorCapturer,
  verifyPlatforms,
  visit,
  isModuleRegistryCall,
  getSortedObject
};