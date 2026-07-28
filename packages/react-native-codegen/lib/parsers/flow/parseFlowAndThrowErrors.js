'use strict';

const hermesParser = require('hermes-parser');
function parseFlowAndThrowErrors(code, options = {}) {
  let ast;
  try {
    ast = hermesParser.parse(code, {
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