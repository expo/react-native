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

const assert = require('assert');
const fs = require('fs');
const yargs = require('yargs');
const argv = yargs
  .option('p', {
    alias: 'platform',
    type: 'string',
    demandOption: true,
  })
  .option('o', {
    alias: 'output',
  })
  .option('s', {
    alias: 'schema-query',
  })
  .parseSync();
const platform = argv.platform.toLowerCase();
const output = argv.output;
const schemaQuery = argv.s;
if (!['ios', 'android'].includes(platform)) {
  throw new Error(`Invalid platform ${platform}`);
}
if (!schemaQuery.startsWith('@')) {
  throw new Error(
    "The argument provided to --schema-query must be a filename that starts with '@'.",
  );
}
const schemaQueryOutputFile = schemaQuery.replace(/^@/, '');
const schemaQueryOutput = fs.readFileSync(schemaQueryOutputFile, 'utf8');
const schemaFiles = schemaQueryOutput.split(' ');
const modules = {};
const specNameToFile = {};
for (const file of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (schema.modules) {
    for (const specName in schema.modules) {
      const module = schema.modules[specName];
      if (modules[specName]) {
        assert.deepEqual(
          module,
          modules[specName],
          `App contained two specs with the same file name '${specName}'. Schemas: ${specNameToFile[specName]}, ${file}. Please rename one of the specs.`,
        );
      }
      if (
        module.excludedPlatforms &&
        module.excludedPlatforms.indexOf(platform) >= 0
      ) {
        continue;
      }
      modules[specName] = module;
      specNameToFile[specName] = file;
    }
  }
}
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      modules,
    },
    null,
    2,
  ),
);
