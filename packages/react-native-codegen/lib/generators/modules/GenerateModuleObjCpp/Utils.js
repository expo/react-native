'use strict';

function getSafePropertyName(property) {
  if (property.name === 'id') {
    return `${property.name}_`;
  }
  return property.name;
}
function getNamespacedStructName(hasteModuleName, structName) {
  return `JS::${hasteModuleName}::${structName}`;
}
module.exports = {
  getSafePropertyName,
  getNamespacedStructName
};