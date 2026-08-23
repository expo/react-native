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
 * Renders every converted SHARED demo document to an HTML page and captures it
 * with real WebKit into the report's web column — one page per
 * `Screen~example` route, same names the device captures use.
 *
 * The registry below is the list of screens that have crossed over to shared
 * documents. A screen not listed here still goes through the legacy regex
 * extractor (extract-demo-html.js) until it is converted; when everything has
 * crossed, the extractor retires.
 */

const {renderDocumentToPage} = require('./render-docs.js');
const {execFileSync, spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const React = require('react');

const DOCS_DIR = path.join(
  __dirname,
  '..',
  'packages',
  'rn-tester',
  'js',
  'examples',
  'HTMLElements',
  'docs',
);

/** screen name → docs module (loaded through babel-register by render-docs). */
const CONVERTED = {
  HTMLGroupingExample: path.join(DOCS_DIR, 'groupingDocs.js'),
  HTMLTextLevelExample: path.join(DOCS_DIR, 'textLevelDocs.js'),
  HTMLEmbeddedExample: path.join(DOCS_DIR, 'embeddedDocs.js'),
  HTMLIntrinsicsDocExample: path.join(DOCS_DIR, 'intrinsicsDocs.js'),
};

/**
 * Routes whose web column is a real page, written by hand, rather than a
 * rendered document — keyed by the same `Screen~example` string everything
 * else here is keyed by.
 *
 * A shared document holds only what both engines render the same way from the
 * same markup, which rules out anything whose subject is *behaviour*. The
 * embedded screen's load lifecycle is the case in point: rendering its
 * document statically would put a list of events into the browser column that
 * no browser had dispatched, which is worse than no column at all because it
 * still looks like evidence. So that route gets a page with real listeners on
 * a real `<img>`, and the page says in its own text where the two engines
 * legitimately differ.
 */
const HAND_WRITTEN = {
  'HTMLEmbeddedExample~loading': path.join(__dirname, 'img-events.html'),
};

const OUT_SHOTS = '/tmp/shots/web';
const PAGES_DIR = path.join(os.tmpdir(), 'doc-pages');

function main() {
  fs.mkdirSync(OUT_SHOTS, {recursive: true});
  fs.mkdirSync(PAGES_DIR, {recursive: true});

  const jobs = [];
  for (const [screen, modulePath] of Object.entries(CONVERTED)) {
     
    const mod = require(modulePath);
    const sections = mod.DOC_SECTIONS;
    if (!Array.isArray(sections)) {
      throw new Error(`${modulePath} exports no DOC_SECTIONS`);
    }
    for (const [name, , Component] of sections) {
      const html = renderDocumentToPage(React.createElement(Component));
      const pagePath = path.join(PAGES_DIR, `${screen}~${name}.html`);
      fs.writeFileSync(pagePath, html);
      jobs.push({
        url: 'file://' + pagePath,
        out: path.join(OUT_SHOTS, `${screen}~${name}.png`),
      });
    }
  }

  for (const [key, pagePath] of Object.entries(HAND_WRITTEN)) {
    if (!fs.existsSync(pagePath)) {
      throw new Error(`hand-written page missing: ${pagePath}`);
    }
    jobs.push({
      url: 'file://' + pagePath,
      out: path.join(OUT_SHOTS, `${key}.png`),
    });
  }

  const wkshot = path.join(__dirname, 'tools', 'wkshot');
  if (!fs.existsSync(wkshot)) {
    execFileSync('swiftc', ['-O', '-o', wkshot, path.join(__dirname, 'tools', 'wkshot.swift')]);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(wkshot, ['402', '3'], {stdio: ['pipe', 'inherit', 'inherit']});
    for (const job of jobs) {
      child.stdin.write(`${job.url}\t${job.out}\n`);
    }
    child.stdin.end();
    child.on('exit', code =>
      code === 0
        ? resolve(console.log(
            `doc pages: ${jobs.length} captured ` +
              `(${jobs.length - Object.keys(HAND_WRITTEN).length} from shared ` +
              `documents, ${Object.keys(HAND_WRITTEN).length} hand-written)`,
          ))
        : reject(new Error(`wkshot exited ${code}`)),
    );
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
