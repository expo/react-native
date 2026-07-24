'use strict';

const {
  FlowParser
} = require('../../parsers/flow/parser');
const {
  TypeScriptParser
} = require('../../parsers/typescript/parser');
const path = require('path');
const flowParser = new FlowParser();
const typescriptParser = new TypeScriptParser();
function parseFiles(files) {
  files.forEach(filename => {
    const isTypeScript = path.extname(filename) === '.ts' || path.extname(filename) === '.tsx';
    const parser = isTypeScript ? typescriptParser : flowParser;
    console.log(filename, JSON.stringify(parser.parseFile(filename), null, 2));
  });
}
module.exports = parseFiles;