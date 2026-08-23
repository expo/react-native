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
 * Renders the extracted demo markup in the system WebKit, one picture per
 * example, so each device screenshot has a browser screenshot beside it.
 * `oracle.js` measures coordinates; this answers whether an element looks like
 * the browser's, which is judged by eye, so the comparison has to be fair: the
 * device's viewport width (wrapping is most of what the cases show), the
 * demo's own wrapper (which sets the type), the device's font
 * (`-apple-system`), and no stylesheet of our own, since the user-agent
 * stylesheet is what is being compared.
 */

const {build} = require('./extract-demo-html.js');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PAGE_PORT = 8901;
const OUT_DIR = '/tmp/shots/web';

// The iPhone 17 Pro simulator the device shots came from, in CSS pixels and
// at its 3x density
const VIEWPORT_WIDTH = 402;
const DEVICE_SCALE = 3;

/*
 * The page inset, measured off the device: RNTester puts every example in its
 * own padded card, so the text column is about 331pt, not the 370pt the
 * screen width and the demo's padding suggest. The three columns still wrap
 * differently (Android's viewport and the platforms' optical sizes differ);
 * exact geometry is `oracle.js`'s job, on font-free cases.
 */
const PAGE_INSET = 36;

function page(cases, wrapper) {
  const body = cases
    .map(
      c => `
    <section>
      <div class="case-title">${escapeHTML(c.title)}</div>
      ${c.note ? `<div class="note">${escapeHTML(c.note)}</div>` : ''}
      ${
        wrapper
          ? `<${wrapper.tag} style="${wrapper.css}">${c.html}</${wrapper.tag}>`
          : c.html
      }
    </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* Only the frame. The UA stylesheet is what is being compared. The frame
     colours mirror the DEVICE columns — RNTester's grouped background and its
     example card — so a three-way diff compares content rather than chrome. */
  html { -webkit-text-size-adjust: 100%; }
  body {
    font-family: -apple-system, system-ui, sans-serif;
    margin: 0; padding: ${PAGE_INSET}px;
    background: #f2f2f7;
  }
  section { margin-bottom: 4px; }
  /*
   * The case label and note, on classes rather than on the h4 and p tags: a
   * bare h4 rule would also restyle the h4 inside the headings case. (No
   * backticks in here: the page is a JS template literal.)
   */
  .case-title {
    font: 12px -apple-system, system-ui, sans-serif;
    color: #6c6c70;
    margin: 14px 0 2px 0;
  }
  .note {
    font: 11px -apple-system, system-ui, sans-serif;
    color: #8e8e93; margin: 0 0 4px 0;
  }
</style></head>
<body>${body}</body></html>`;
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function main() {
  const {screens, skipped, total} = build();

  // screen -> group -> cases
  const pages = [];
  for (const s of screens) {
    const groups = new Map();
    for (const c of s.cases) {
      const g = c.group ?? 'ungrouped';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    for (const [g, cs] of groups) {
      pages.push({key: `${s.name}Example~${g}`, cases: cs, wrapper: s.wrapper});
    }
  }

  fs.mkdirSync(OUT_DIR, {recursive: true});

  /*
   * Pages are served by key so the whole batch runs against one server
   */
  const byKey = new Map(pages.map(p => [p.key, p]));
  const server = http
    .createServer((req, res) => {
      const key = new URL(req.url, 'http://x').searchParams.get('p');
      const p = byKey.get(key) ?? pages[0];
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(page(p.cases, p.wrapper));
    })
    .listen(PAGE_PORT);

  /*
   * `tools/wkshot` rather than safaridriver: safaridriver screenshots the
   * Safari window, bounded by the physical display and its density, while a
   * web view lays out at the device's CSS width, rasters at its density and
   * captures the full page height
   */
  const jobs = pages
    .map(
      p =>
        `http://localhost:${PAGE_PORT}/?p=${encodeURIComponent(p.key)}\t` +
        `${path.join(OUT_DIR, `${p.key}.png`)}`,
    )
    .join('\n');

  try {
    await new Promise((resolve, reject) => {
      const shooter = spawn(
        path.join(__dirname, 'tools', 'wkshot'),
        [String(VIEWPORT_WIDTH), String(DEVICE_SCALE)],
        {stdio: ['pipe', 'inherit', 'inherit']},
      );
      shooter.stdin.write(jobs);
      shooter.stdin.end();
      shooter.on('exit', code =>
        code === 0 ? resolve() : reject(new Error(`wkshot exited ${code}`)),
      );
      shooter.on('error', reject);
    });
    console.log(
      `\n${pages.length} pages from WebKit at ${VIEWPORT_WIDTH}px x${DEVICE_SCALE}; ` +
        `${total - skipped}/${total} cases extracted, ${skipped} not pure markup`,
    );
  } finally {
    server.close();
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
