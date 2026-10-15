/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @noflow
 */

'use strict';

/**
 * Copies the page templates this app ships from the Astryx checkout, byte for
 * byte, and writes `templates/registry.json` from each template's
 * `template.doc.mjs`. Run it after moving the checkout to a new release:
 *
 *   node scripts/sync-templates.js [path to facebook/astryx]
 *
 * A template that has to differ from upstream is listed in
 * `templates/modifications.js`; this script refuses to overwrite one of those
 * so the edit is not lost, and `--check` reports any template that drifted
 * from upstream without being listed there.
 */

const {TEMPLATES} = require('../templates/list.js');
const {MODIFIED} = require('../templates/modifications.js');
const fs = require('node:fs');
const path = require('node:path');

const checkout = path.resolve(
  process.argv.find(
    a => !a.startsWith('--') && a !== process.argv[0] && a !== process.argv[1],
  ) ?? path.resolve(__dirname, '../../../../astryx-upstream'),
);
const check = process.argv.includes('--check');
const upstream = path.join(checkout, 'packages/cli/assets/templates/pages');
const here = path.resolve(__dirname, '../templates');

function docOf(slug) {
  const text = fs.readFileSync(
    path.join(upstream, slug, 'template.doc.mjs'),
    'utf8',
  );
  const field = key =>
    text.match(new RegExp(`\\b${key}:\\s*'([^']*)'`))?.[1] ?? null;
  return {
    slug,
    name: field('displayName') ?? field('name') ?? slug,
    category: field('category') ?? '',
    description: (
      text.match(/description:\s*((?:'[^']*'\s*\+?\s*)+)/)?.[1] ?? ''
    )
      .split(/'\s*\+\s*'|'\s*,?\s*$/)
      .map(s => s.replace(/^'|'$/g, ''))
      .join('')
      .trim(),
  };
}

const version = JSON.parse(
  fs.readFileSync(path.join(checkout, 'packages/core/package.json'), 'utf8'),
).version;
let drifted = 0;
const registry = [];
for (const slug of TEMPLATES) {
  const source = path.join(upstream, slug, 'page.tsx');
  const target = path.join(here, slug, 'page.tsx');
  const upstreamText = fs.readFileSync(source);
  const modified = MODIFIED.some(m => m.slug === slug);
  if (fs.existsSync(target)) {
    const same = upstreamText.equals(fs.readFileSync(target));
    if (!same && !modified) {
      drifted += 1;
      console.error(
        `${slug}: differs from upstream but is not listed in templates/modifications.js`,
      );
    }
    if (!same && modified) {
      console.log(`${slug}: keeping the listed modification`);
    }
  }
  if (!check && !modified) {
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, upstreamText);
  }
  registry.push(docOf(slug));
}
if (!check) {
  fs.writeFileSync(
    path.join(here, 'registry.json'),
    JSON.stringify({astryxVersion: version, templates: registry}, null, 2) +
      '\n',
  );
  console.log(`${registry.length} templates from Astryx ${version}`);
}
process.exit(drifted > 0 ? 1 : 0);
