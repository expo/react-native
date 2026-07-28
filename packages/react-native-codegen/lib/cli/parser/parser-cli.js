'use strict';

const parseFiles = require('./parser.js');
const [...fileList] = process.argv.slice(2);
parseFiles(fileList);