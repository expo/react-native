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

function ownKeys(e, r) {
  var t = Object.keys(e);
  if (Object.getOwnPropertySymbols) {
    var o = Object.getOwnPropertySymbols(e);
    r &&
      (o = o.filter(function (r) {
        return Object.getOwnPropertyDescriptor(e, r).enumerable;
      })),
      t.push.apply(t, o);
  }
  return t;
}
function _objectSpread(e) {
  for (var r = 1; r < arguments.length; r++) {
    var t = null != arguments[r] ? arguments[r] : {};
    r % 2
      ? ownKeys(Object(t), !0).forEach(function (r) {
          _defineProperty(e, r, t[r]);
        })
      : Object.getOwnPropertyDescriptors
      ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t))
      : ownKeys(Object(t)).forEach(function (r) {
          Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
        });
  }
  return e;
}
function _defineProperty(e, r, t) {
  return (
    (r = _toPropertyKey(r)) in e
      ? Object.defineProperty(e, r, {
          value: t,
          enumerable: !0,
          configurable: !0,
          writable: !0,
        })
      : (e[r] = t),
    e
  );
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, 'string');
  return 'symbol' == typeof i ? i : i + '';
}
function _toPrimitive(t, r) {
  if ('object' != typeof t || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || 'default');
    if ('object' != typeof i) return i;
    throw new TypeError('@@toPrimitive must return a primitive value.');
  }
  return ('string' === r ? String : Number)(t);
}
const _require = require('../../parsers/flow/parser'),
  FlowParser = _require.FlowParser;
const _require2 = require('../../parsers/typescript/parser'),
  TypeScriptParser = _require2.TypeScriptParser;
const _require3 = require('./combine-utils'),
  filterJSFile = _require3.filterJSFile;
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const flowParser = new FlowParser();
const typescriptParser = new TypeScriptParser();
function combineSchemas(files) {
  return files.reduce(
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
          merged.modules = _objectSpread(
            _objectSpread({}, merged.modules),
            schema.modules,
          );
        }
      }
      return merged;
    },
    {
      modules: {},
    },
  );
}
function expandDirectoriesIntoFiles(fileList, platform, exclude) {
  return fileList
    .flatMap(file => {
      if (!fs.lstatSync(file).isDirectory()) {
        return [file];
      }
      const filePattern = path.sep === '\\' ? file.replace(/\\/g, '/') : file;
      return glob.sync(`${filePattern}/**/*.{js,ts,tsx}`, {
        nodir: true,
        // TODO: This will remove the need of slash substitution above for Windows,
        // but it requires glob@v9+; with the package currenlty relying on
        // glob@7.1.1; and flow-typed repo not having definitions for glob@9+.
        // windowsPathsNoEscape: true,
      });
    })
    .filter(element => filterJSFile(element, platform, exclude));
}
function combineSchemasInFileList(fileList, platform, exclude) {
  const expandedFileList = expandDirectoriesIntoFiles(
    fileList,
    platform,
    exclude,
  );
  const combined = combineSchemas(expandedFileList);
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
) {
  const combined = combineSchemasInFileList(fileList, platform, exclude);
  const formattedSchema = JSON.stringify(combined);
  fs.writeFileSync(outfile, formattedSchema);
}
module.exports = {
  combineSchemas,
  combineSchemasInFileList,
  combineSchemasInFileListAndWriteToFile,
};
