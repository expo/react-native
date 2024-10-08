/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 *
 * @format
 * @oncall react_native
 */

'use strict';

function _toArray(r) {
  return (
    _arrayWithHoles(r) ||
    _iterableToArray(r) ||
    _unsupportedIterableToArray(r) ||
    _nonIterableRest()
  );
}
function _nonIterableRest() {
  throw new TypeError(
    'Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.',
  );
}
function _unsupportedIterableToArray(r, a) {
  if (r) {
    if ('string' == typeof r) return _arrayLikeToArray(r, a);
    var t = {}.toString.call(r).slice(8, -1);
    return (
      'Object' === t && r.constructor && (t = r.constructor.name),
      'Map' === t || 'Set' === t
        ? Array.from(r)
        : 'Arguments' === t ||
          /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)
        ? _arrayLikeToArray(r, a)
        : void 0
    );
  }
}
function _arrayLikeToArray(r, a) {
  (null == a || a > r.length) && (a = r.length);
  for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
  return n;
}
function _iterableToArray(r) {
  if (
    ('undefined' != typeof Symbol && null != r[Symbol.iterator]) ||
    null != r['@@iterator']
  )
    return Array.from(r);
}
function _arrayWithHoles(r) {
  if (Array.isArray(r)) return r;
}
const _require = require('./combine-js-to-schema'),
  combineSchemasInFileListAndWriteToFile =
    _require.combineSchemasInFileListAndWriteToFile;
const yargs = require('yargs');
const argv = yargs
  .option('p', {
    alias: 'platform',
  })
  .option('e', {
    alias: 'exclude',
  })
  .parseSync();
const _argv$_ = _toArray(argv._),
  outfile = _argv$_[0],
  fileList = _argv$_.slice(1);
const platform = argv.platform;
const exclude = argv.exclude;
const excludeRegExp =
  exclude != null && exclude !== '' ? new RegExp(exclude) : null;
combineSchemasInFileListAndWriteToFile(
  fileList,
  platform != null ? platform.toLowerCase() : platform,
  outfile,
  excludeRegExp,
);
