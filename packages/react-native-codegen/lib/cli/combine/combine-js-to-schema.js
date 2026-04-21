/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 */

'use strict';

const {FlowParser} = require('../../parsers/flow/parser');
const {TypeScriptParser} = require('../../parsers/typescript/parser');
const {filterJSFile} = require('./combine-utils');
const fs = require('fs');
const path = require('path');
const {globSync} = require('tinyglobby');
const flowParser = new FlowParser();
const typescriptParser = new TypeScriptParser();
function combineSchemas(files, libraryName) {
  const combined = files.reduce(
    (merged, filename) => {
      const contents = fs.readFileSync(filename, 'utf8');
      if (
        contents &&
        (/export\s+default\s+\(?codegenNativeComponent</.test(contents) ||
          /extends TurboModule/.test(contents))
      ) {
        const isTypeScript =
          path.extname(filename) === '.ts' || path.extname(filename) === '.tsx';
        const parser = isTypeScript ? typescriptParser : flowParser;
        const schema = parser.parseFile(filename);
        if (schema && schema.modules) {
          merged.modules = {
            ...merged.modules,
            ...schema.modules,
          };
        }
      }
      return merged;
    },
    {
      modules: {} /*:: as SchemaType['modules'] */,
    },
  );
  return {
    libraryName: libraryName || '',
    modules: combined.modules,
  };
}
function expandDirectoriesIntoFiles(fileList, platform, exclude) {
  return fileList
    .flatMap(file => {
      if (!fs.lstatSync(file).isDirectory()) {
        return [file];
      }
      return globSync('**/*{,.fb}.{js,ts,tsx}', {
        expandDirectories: false,
        onlyFiles: true,
        absolute: true,
        cwd: file,
      });
    })
    .filter(element => filterJSFile(element, platform, exclude));
}
function combineSchemasInFileList(fileList, platform, exclude, libraryName) {
  const expandedFileList = expandDirectoriesIntoFiles(
    fileList,
    platform,
    exclude,
  );
  const combined = combineSchemas(expandedFileList, libraryName);
  if (Object.keys(combined.modules).length === 0) {
    console.error(
      'No modules to process in combine-js-to-schema-cli. If this is unexpected, please check if you set up your NativeComponent correctly. See combine-js-to-schema.js for how codegen finds modules.',
    );
  }
  return combined;
}
function combineSchemasInFileListAndWriteToFile(
  fileList,
  platform,
  outfile,
  exclude,
  libraryName,
) {
  const combined = combineSchemasInFileList(
    fileList,
    platform,
    exclude,
    libraryName,
  );
  const formattedSchema = JSON.stringify(combined);
  fs.writeFileSync(outfile, formattedSchema);
}
module.exports = {
  combineSchemas,
  combineSchemasInFileList,
  combineSchemasInFileListAndWriteToFile,
};
