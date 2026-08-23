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
 * Renders the extracted demo markup in the system WebKit — the engine
 * Safari.app links — one picture per example, so each device screenshot has a
 * browser screenshot to sit beside.
 *
 * `oracle.js` next door answers a different question — it measures coordinates
 * and asserts on them. This one answers "does it *look* like the browser", which
 * no coordinate can settle: `<kbd>` in a box, `<mark>`'s highlight ending where
 * the word does, a `<figcaption>` sitting under its figure. Those are judged by
 * looking, so the job here is to make looking fair.
 *
 * ## What "fair" required
 *
 * - **The same viewport.** 402 CSS px, the iPhone 17 Pro width the device shots
 *   were taken at. Wrapping is most of what these cases demonstrate, and
 *   wrapping is a function of width, so a desktop-width browser page would
 *   differ from the device everywhere and mean nothing anywhere.
 * - **The demo's own wrapper.** Each screen sets the type its cases are read
 *   at — `<div style={PROSE}>` on the text-level screen — and the browser is
 *   given the same. Without it the two sides are set in different type and
 *   every line wraps somewhere else, which looks exactly like WebKit and
 *   CoreText disagreeing about font metrics and is not that at all.
 * - **The same font.** `-apple-system` is San Francisco, which is what the
 *   device draws with. Left at Safari's default the browser would render
 *   Times, and every single case would "differ" for a reason that has nothing
 *   to do with this project.
 * - **No stylesheet of our own.** Beyond the two above and the demo's own
 *   inline styles, the page adds nothing: the browser's user-agent stylesheet
 *   is the thing under comparison, and a reset would erase the very defaults
 *   the native UA sheet is being checked against.
 */

const {build} = require('./extract-demo-html.js');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PAGE_PORT = 8901;
const OUT_DIR = '/tmp/shots/web';

// The iPhone 17 Pro simulator the device shots came from, in CSS pixels —
// and its 3x density, so the browser captures sit beside the device's at the
// same sharpness.
const VIEWPORT_WIDTH = 402;
const DEVICE_SCALE = 3;

/*
 * The page inset, measured off the device rather than assumed.
 *
 * RNTester puts every example inside its own padded card, so the text column
 * on screen is ~331pt, not the 370pt a 402pt screen with the demo's own 16pt
 * padding would suggest. Giving the browser the full 370 makes it fit roughly
 * one extra word per line, and since these cases are largely *about* wrapping,
 * that difference lands on every line of every case and reads like WebKit
 * breaking lines differently from CoreText.
 *
 * Even matched, the three columns still wrap differently — Android's viewport
 * is 411dp with its own container padding, and the platforms shape text with
 * different optical sizes of San Francisco. Exact geometry is pinned by
 * `oracle.js` on deliberately font-free cases; what this page is for is
 * whether the *elements* look right, which does not depend on the break points.
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
   * The case label and note, on classes rather than on the h4 and p tags.
   * (No backticks in here: this whole page is a JS template literal.)
   *
   * A bare h4 rule also matches the h4 *inside* a case — the headings demo
   * shows h1 through h6 — so styling the label by tag silently restyles the
   * content being demonstrated. In that screenshot h4 came out small, grey and
   * unbolded, which reads as WebKit having odd UA defaults for h4 and is
   * really this page overriding them.
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
   * Pages are served by key so the whole batch can run against one server —
   * wkshot loads them in sequence and there is no navigation to coordinate.
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
   * WKWebView rather than safaridriver, for one reason: safaridriver
   * screenshots the Safari *window*, so its captures are bounded by the
   * physical display — and this machine's is 1x, which put a 402px browser
   * column beside 1206px device screenshots and made every web capture read
   * as blurry. `tools/wkshot` renders the same system WebKit with no window
   * at all: layout at the device's CSS width, raster at the device's density,
   * full page height. The old flow also had to size Safari's window by
   * trial-and-error to get the viewport right; a web view's frame IS the
   * viewport, so that correction loop is gone with the window.
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
