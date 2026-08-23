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
 * Serves the conformance corpus as a web page.
 *
 * THE SAME HTML, from the same function. `oracle.js` builds the page it hands
 * to Safari with `page()`, and this serves that call — not a saved copy, and
 * not a second renderer that would drift from it. Whatever a browser shows
 * here is what the oracle measured, which is the only way the web view is
 * evidence about the same corpus the devices run.
 *
 * Importing `oracle.js` does NOT start a Safari session; `main()` is guarded.
 *
 *   node text-conformance/serve.js [port]
 */

const {page} = require('./oracle');
const http = require('node:http');

const port = Number(process.argv[2] ?? 8910);

http
  .createServer((req, res) => {
    // One page at every path: a corpus has no routes, and a 404 for /favicon
    // is noise in the log rather than information.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Regenerated per request, so an edit to cases.js is a reload away.
      'Cache-Control': 'no-store',
    });
    res.end(page());
  })
  .listen(port, () => {
    console.log(`conformance corpus on http://localhost:${port}`);
  });
