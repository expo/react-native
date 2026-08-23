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

/**
 * Renders the corpus in Safari and writes `expected.json`. A real browser
 * rather than a spec reading, because the cases where an implementation is
 * wrong are the cases where a reading of the spec was wrong; WebKit is also
 * the engine closest to iOS's text stack. Driven through safaridriver's plain
 * WebDriver HTTP API.
 */

const {CASES, runGapChecks, toHTML} = require('./cases');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DRIVER_PORT = 4444;
const PAGE_PORT = 8899;

function page() {
  const sections = CASES.map(
    c => `
    <section data-case="${c.name}">
      <div class="case-label">${c.name}</div>
      ${toHTML(c.tree)}
    </section>`,
  ).join('\n');

  /*
   * Rects are reported relative to each case's own root, so the page's own
   * geometry, and the presentation chrome below that mirrors the device
   * screen (gen-device-screen.js), never enters the measured numbers
   */
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; border: 0; box-sizing: content-box; }
  body { font-family: -apple-system, sans-serif; padding: 16px; }
  .intro { font-size: 11px; color: #8E8E93; margin-bottom: 8px; }
  /*
   * Case titles in full-contrast body colour, as the device screen's primary
   * label, so the two presentations read the same. (No backticks in this
   * comment: it lives inside a template literal.)
   */
  .case-label { font-size: 10px; color: #1C1C1E; margin-bottom: 2px; }
  section { margin-bottom: 24px; }
</style>
</head><body>
<div class="intro">${CASES.length} cases — one corpus (cases.js), rendered by this browser and by the device screens from the same trees.</div>
${sections}
</body></html>`;
}

const COLLECT = `
  const out = {};
  for (const section of document.querySelectorAll('section[data-case]')) {
    const name = section.getAttribute('data-case');
    const root = section.querySelector('[data-m="root"]');
    const rootRect = root.getBoundingClientRect();
    const rects = {};
    for (const el of section.querySelectorAll('[data-m]')) {
      const r = el.getBoundingClientRect();
      // Relative to the case's own root, so page chrome cannot leak in
      rects[el.getAttribute('data-m')] = {
        x: +(r.left - rootRect.left).toFixed(2),
        y: +(r.top - rootRect.top).toFixed(2),
        width: +r.width.toFixed(2),
        height: +r.height.toFixed(2),
      };
    }
    out[name] = rects;
  }
  return JSON.stringify(out);
`;

function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? {'Content-Length': Buffer.byteLength(data)} : {}),
        },
      },
      res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error(`${url}: ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (data) {
      req.write(data);
    }
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.writeFileSync(path.join(__dirname, 'corpus.html'), page());

  const server = http
    .createServer((req, res) => {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(page());
    })
    .listen(PAGE_PORT);

  const driver = spawn('safaridriver', ['-p', String(DRIVER_PORT)], {
    stdio: 'ignore',
  });
  await sleep(1500);

  let sessionId = null;
  try {
    const session = await request(
      'POST',
      `http://localhost:${DRIVER_PORT}/session`,
      {capabilities: {alwaysMatch: {browserName: 'safari'}}},
    );
    sessionId = session.value?.sessionId;
    if (sessionId == null) {
      throw new Error(`no session: ${JSON.stringify(session).slice(0, 300)}`);
    }
    const base = `http://localhost:${DRIVER_PORT}/session/${sessionId}`;

    // A fixed window so the 300px containers are never the constraint
    await request('POST', `${base}/window/rect`, {
      width: 1000,
      height: 900,
      x: 0,
      y: 0,
    });
    await request('POST', `${base}/url`, {
      url: `http://localhost:${PAGE_PORT}/`,
    });
    await sleep(600);

    const result = await request('POST', `${base}/execute/sync`, {
      script: COLLECT,
      args: [],
    });
    if (result.value == null || typeof result.value !== 'string') {
      throw new Error(
        `collect failed: ${JSON.stringify(result).slice(0, 400)}`,
      );
    }
    // A picture of the same page, so the visual check is three-way
    const shot = await request('GET', `${base}/screenshot`, undefined);
    if (typeof shot.value === 'string') {
      fs.writeFileSync(
        path.join(__dirname, 'safari-corpus.png'),
        Buffer.from(shot.value, 'base64'),
      );
      console.log('safari-corpus.png written');
    }

    const rects = JSON.parse(result.value);

    /*
     * Safari has to satisfy every case's own checks before its numbers become
     * the standard; otherwise a case wrong about the spec would be frozen into
     * `expected.json`
     */
    const badCases = [];
    for (const testCase of CASES) {
      const caseRects = rects[testCase.name];
      if (caseRects == null) {
        badCases.push(`${testCase.name}: Safari reported nothing`);
        continue;
      }
      for (const problem of runGapChecks(testCase, caseRects)) {
        badCases.push(`${testCase.name}: ${problem}`);
      }
    }
    if (badCases.length > 0) {
      console.error('Safari does not satisfy these cases, so they are not a');
      console.error('standard to hold anything to. expected.json NOT written:');
      for (const line of badCases) {
        console.error(`  ${line}`);
      }
      process.exit(1);
    }

    fs.writeFileSync(
      path.join(__dirname, 'expected.json'),
      JSON.stringify(rects, null, 2),
    );
    console.log(
      `expected.json: ${Object.keys(rects).length} cases from real Safari`,
    );
  } finally {
    if (sessionId != null) {
      await request(
        'DELETE',
        `http://localhost:${DRIVER_PORT}/session/${sessionId}`,
      ).catch(() => {});
    }
    driver.kill();
    server.close();
  }
}

/*
 * `page` is exported so `serve.js` serves the page the oracle measured, and
 * the guard keeps that import from starting a Safari session
 */
module.exports = {page};

if (require.main === module) {
  main().catch(err => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
