'use strict';

function getValueFromTypes(value, types) {
  if (value.type === 'GenericTypeAnnotation' && types[value.id.name]) {
    return getValueFromTypes(types[value.id.name].right, types);
  }
  return value;
}
module.exports = {
  getValueFromTypes
};