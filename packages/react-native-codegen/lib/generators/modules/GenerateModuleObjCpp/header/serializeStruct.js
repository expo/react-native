'use strict';

const {
  serializeConstantsStruct
} = require('./serializeConstantsStruct');
const {
  serializeRegularStruct
} = require('./serializeRegularStruct');
function serializeStruct(hasteModuleName, struct) {
  if (struct.context === 'REGULAR') {
    return serializeRegularStruct(hasteModuleName, struct);
  }
  return serializeConstantsStruct(hasteModuleName, struct);
}
module.exports = {
  serializeStruct
};