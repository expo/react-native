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
 * Runs the style engine's conformance corpus (cases.js) in Mobile Safari on
 * an iOS simulator — WebKit, on the platform the engine draws for — and
 * writes `expected.json`: what Safari computes for every read. Safari must
 * first agree with every case's own spec reading (`expect`), or nothing is
 * written, since a case that misreads the spec must not become the standard.
 *
 *   node oracle.js <simulator UDID>
 *
 * The page runs the corpus as it loads and posts the answers back here.
 */

const {CASES, PRELUDE} = require('./cases');
const {compareRead} = require('./compare');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PAGE_PORT = 8901;

// Runs in Safari: each case alone, its sheet and tree added and then removed
const COLLECT = `
const [cases, prelude] = arguments;
const out = {};
function build(node, parent, isRoot) {
  const [tag, attributes, children] = node;
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') {
      element.className = value;
    } else {
      element.setAttribute(name, value);
    }
  }
  if (isRoot) {
    element.id = 'root';
  }
  parent.appendChild(element);
  for (const child of children) {
    build(child, element, false);
  }
  return element;
}
function color(text) {
  const rgb = /^rgba?\\(([^)]*)\\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  const srgb = /^color\\(srgb ([^)]*)\\)$/.exec(text);
  if (srgb) {
    const parts = srgb[1].split(/[\\s\\/]+/).filter(Boolean).map(Number);
    return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts.length > 3 ? parts[3] : 1];
  }
  return text;
}
for (const testCase of cases) {
  const style = document.createElement('style');
  style.textContent = prelude + testCase.css;
  document.head.appendChild(style);
  const root = build(testCase.tree, document.body, true);
  const origin = root.getBoundingClientRect();
  const reads = [];
  for (const read of testCase.reads) {
    const element = document.getElementById(read.id);
    if (element == null) {
      reads.push({error: 'no element #' + read.id});
      continue;
    }
    if (read.rect) {
      const r = element.getBoundingClientRect();
      reads.push({rect: [r.left - origin.left, r.top - origin.top, r.width, r.height]});
    } else if (read.background) {
      reads.push({background: color(getComputedStyle(element).backgroundColor)});
    } else if (read.matches != null) {
      reads.push({matches: element.matches(read.matches)});
    } else if (read.custom != null) {
      reads.push({custom: getComputedStyle(element).getPropertyValue(read.custom).trim()});
    }
  }
  out[testCase.name] = reads;
  root.remove();
  style.remove();
}
return JSON.stringify(out);
`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body style="margin:0"><script>
(function () {
const collect = function () {${COLLECT}};
const cases = ${JSON.stringify(
  CASES.map(({name, css, tree, reads}) => ({name, css, tree, reads})),
)};
let body;
try {
  body = collect.apply(null, [cases, ${JSON.stringify(PRELUDE)}]);
} catch (e) {
  body = JSON.stringify({__error: String(e && e.stack || e)});
}
fetch('/result', {method: 'POST', body});
})();
</script></body></html>`;

async function main() {
  const simulator = process.argv[2];
  if (simulator == null) {
    throw new Error(
      'Give the UDID of a booted iOS simulator: `node oracle.js <UDID>` ' +
        '(`xcrun simctl list devices booted` lists them).',
    );
  }
  const answer = new Promise(resolve => {
    const server = http
      .createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/result') {
          let text = '';
          req.on('data', chunk => (text += chunk));
          req.on('end', () => {
            res.writeHead(204);
            res.end();
            server.close();
            resolve(text);
          });
          return;
        }
        res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
        res.end(PAGE);
      })
      .listen(PAGE_PORT);
  });
  execFileSync('xcrun', [
    'simctl',
    'openurl',
    simulator,
    `http://localhost:${PAGE_PORT}/?t=${Date.now()}`,
  ]);
  const actual = JSON.parse(await answer);
  if (actual.__error != null) {
    throw new Error(`The corpus threw in Safari: ${actual.__error}`);
  }

  const problems = [];
  const expected = {};
  for (const testCase of CASES) {
    const reads = actual[testCase.name] ?? [];
    expected[testCase.name] = reads;
    testCase.reads.forEach((read, index) => {
      const problem = compareRead(read, read, reads[index]);
      if (problem != null) {
        problems.push(
          `${testCase.name} (${testCase.spec}) read ${index}: ${problem}`,
        );
      }
    });
  }
  if (problems.length > 0) {
    console.error(
      'Safari does not agree with these readings of the spec, so ' +
        'expected.json was not written:',
    );
    for (const line of problems) {
      console.error('  ' + line);
    }
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(
    path.join(__dirname, 'expected.json'),
    JSON.stringify(expected, null, 1) + '\n',
  );
  console.log(`expected.json written: ${CASES.length} cases`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
