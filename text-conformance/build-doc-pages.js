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
 * Renders every shared demo document to an HTML page and captures it with
 * WebKit into the report's web column, one page per `Screen~example` route.
 * A screen not in the registry below goes through extract-demo-html.js.
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

/** screen name → docs module, loaded through babel-register by render-docs */
const CONVERTED = {
  HTMLGroupingExample: path.join(DOCS_DIR, 'groupingDocs.js'),
  HTMLTextLevelExample: path.join(DOCS_DIR, 'textLevelDocs.js'),
  HTMLEmbeddedExample: path.join(DOCS_DIR, 'embeddedDocs.js'),
  HTMLIntrinsicsDocExample: path.join(DOCS_DIR, 'intrinsicsDocs.js'),
};

/**
 * Routes whose web column is a hand-written page rather than a rendered
 * document, because their subject is behaviour: the embedded screen's load
 * lifecycle needs real listeners on a real `<img>`, not a static list of
 * events no browser dispatched.
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
    execFileSync('swiftc', [
      '-O',
      '-o',
      wkshot,
      path.join(__dirname, 'tools', 'wkshot.swift'),
    ]);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(wkshot, ['402', '3'], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    for (const job of jobs) {
      child.stdin.write(`${job.url}\t${job.out}\n`);
    }
    child.stdin.end();
    child.on('exit', code =>
      code === 0
        ? resolve(
            console.log(
              `doc pages: ${jobs.length} captured ` +
                `(${jobs.length - Object.keys(HAND_WRITTEN).length} from shared ` +
                `documents, ${Object.keys(HAND_WRITTEN).length} hand-written)`,
            ),
          )
        : reject(new Error(`wkshot exited ${code}`)),
    );
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
