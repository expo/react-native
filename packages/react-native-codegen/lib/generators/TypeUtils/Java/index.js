const objectTypeForPrimitiveType = {
  boolean: 'Boolean',
  double: 'Double',
  float: 'Float',
  int: 'Integer'
};
function wrapOptional(type, isRequired) {
  var _objectTypeForPrimiti;
  return isRequired ? type : `@Nullable ${(_objectTypeForPrimiti = objectTypeForPrimitiveType[type]) !== null && _objectTypeForPrimiti !== void 0 ? _objectTypeForPrimiti : type}`;
}
module.exports = {
  wrapOptional
};