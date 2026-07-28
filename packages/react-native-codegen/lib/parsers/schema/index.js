'use strict';

function parse(filename) {
  try {
    return require(filename);
  } catch (err) {}
}
module.exports = {
  parse
};