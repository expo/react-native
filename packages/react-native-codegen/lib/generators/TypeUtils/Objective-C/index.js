function wrapOptional(type, isRequired) {
  return isRequired ? type : `${type} _Nullable`;
}
module.exports = {
  wrapOptional
};