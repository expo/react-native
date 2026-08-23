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
 * Renders the corpus in real Safari and writes `expected.json`.
 *
 * Real Safari rather than a headless engine or a spec reading, because the
 * question this answers is "what does a browser actually do", and the cases
 * where an implementation is wrong are exactly the cases where someone's
 * reading of the spec was wrong. WebKit is also the closest engine to iOS's own
 * text stack, which makes a disagreement more likely to be ours.
 *
 * Driven through safaridriver's plain WebDriver HTTP API — no selenium
 * dependency, and Apple Events to Safari are blocked on this machine anyway, so
 * scripted WebDriver is the only way in.
 */

const {CASES, toHTML} = require('./cases');
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
      ${toHTML(c.tree)}
    </section>`,
  ).join('\n');

  /*
   * The reset matters more than it looks. A default stylesheet's body margin
   * and the container's own borders would shift every coordinate by a constant,
   * and a constant offset is exactly the kind of difference that looks like a
   * layout bug. Rects are reported relative to each case's own root, so the
   * page's own geometry cancels out entirely.
   */
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; border: 0; box-sizing: content-box; }
  body { font-family: -apple-system, sans-serif; }
  section { margin-bottom: 40px; }
</style>
</head><body>
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
      // Relative to the case's own root, so page chrome cannot leak in.
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

    // A fixed window so the 300px containers are never the constraint.
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
    // A picture of the same page, so the final visual check is three-way —
    // browser, iOS, Android — rather than two device screenshots agreeing with
    // each other about something the browser does differently.
    const shot = await request('GET', `${base}/screenshot`, undefined);
    if (typeof shot.value === 'string') {
      fs.writeFileSync(
        path.join(__dirname, 'safari-corpus.png'),
        Buffer.from(shot.value, 'base64'),
      );
      console.log('safari-corpus.png written');
    }

    const rects = JSON.parse(result.value);
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

main().catch(err => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
