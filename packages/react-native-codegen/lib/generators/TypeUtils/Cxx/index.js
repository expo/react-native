function wrapOptional(type, isRequired) {
  return isRequired ? type : `std::optional<${type}>`;
}
module.exports = {
  wrapOptional
};