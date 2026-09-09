'use strict';

const flowParser = require('flow-parser');
function parseFlowAndThrowErrors(code, options = {}) {
  let ast;
  try {
    ast = flowParser.parse(code, {
      babel: false,
      flow: 'all',
      reactRuntimeTarget: '19',
      ...(options.filename != null ? {
        sourceFilename: options.filename
      } : {})
    });
  } catch (e) {
    if (options.filename != null) {
      e.message = `Syntax error in ${options.filename}: ${e.message}`;
    }
    throw e;
  }
  return ast;
}
module.exports = {
  parseFlowAndThrowErrors
};