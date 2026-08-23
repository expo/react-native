/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/*
 * Serves the conformance corpus as a web page: the same `page()` the oracle
 * hands to Safari, not a copy that could drift. Importing `oracle.js` does not
 * start a Safari session; its `main()` is guarded.
 *
 *   node text-conformance/serve.js [port]
 */

const {page} = require('./oracle');
const http = require('node:http');

const port = Number(process.argv[2] ?? 8910);

http
  .createServer((req, res) => {
    // One page at every path: a corpus has no routes
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Regenerated per request, so an edit to cases.js is a reload away
      'Cache-Control': 'no-store',
    });
    res.end(page());
  })
  .listen(port, () => {
    console.log(`conformance corpus on http://localhost:${port}`);
  });
