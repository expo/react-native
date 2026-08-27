/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {REPO_ROOT} from '../../shared/consts';
import fs from 'node:fs';
import path from 'node:path';
import {globSync} from 'tinyglobby';

/**
 * `dom-css-limitations.md` opens by saying it cannot quietly drift out of date,
 * because every limitation is marked at the code that has it. That only holds
 * if something checks it, and nothing did: entries survived describing a fork
 * from several features ago — one of them saying CSS Grid was not implemented.
 *
 * Every entry that went stale had no marker in the code, so there was nothing
 * to notice when the code changed. This is what makes the claim true.
 */

const REGISTER = path.join(REPO_ROOT, 'dom-css-limitations.md');

/*
 * The convention the register describes: a marker in a comment beside the code
 * — `DOM-CSS-LIMITATION(slug)` for something not implemented,
 * `DOM-CSS-DEVIATION(slug)` for a deliberate difference — and a row in the
 * register whose bolded lead-in names the same slug. `slug` itself is the
 * placeholder in the file's explanation of the convention.
 *
 * Only rows in one of the two shapes below are limitations; the register also
 * carries informational rows ("`grid-auto-flow` is fully implemented"), which
 * name nothing in the code and are not meant to.
 */
const MARKER = /DOM-CSS-(?:LIMITATION|DEVIATION)\(([a-z0-9-]+)\)/g;
const ENTRY_ROWS = [
  /^\*\*`([a-z0-9-]+)`\*\*/gm,
  /^- \*\*`DOM-CSS-LIMITATION\(([a-z0-9-]+)\)`/gm,
  // The index rows under "Every other marked divergence": slug, kind, file.
  // A bare pointer at the marker rather than prose, for the ones whose
  // reasoning lives at the code and only needs finding.
  /^- `([a-z0-9-]+)` — (?:limitation|deviation), /gm,
];
const PLACEHOLDER = 'slug';

function slugsIn(source: string, pattern: RegExp): Set<string> {
  return new Set(
    [...source.matchAll(pattern)]
      .map(match => match[1])
      .filter(slug => slug !== PLACEHOLDER),
  );
}

function markedSlugs(): Set<string> {
  const files = globSync(['packages/**/*.{js,h,cpp,mm,kt}'], {
    cwd: REPO_ROOT,
    ignore: ['**/node_modules/**', '**/.out/**', '**/build/**'],
    absolute: true,
  });
  const slugs = new Set<string>();
  for (const file of files) {
    for (const slug of slugsIn(fs.readFileSync(file, 'utf8'), MARKER)) {
      slugs.add(slug);
    }
  }
  return slugs;
}

describe('dom-css-limitations.md', () => {
  test('every limitation in the register is marked in the code', () => {
    const register = fs.readFileSync(REGISTER, 'utf8');
    const documented = new Set(
      ENTRY_ROWS.flatMap(pattern => [...slugsIn(register, pattern)]),
    );
    const marked = markedSlugs();

    // An entry with no marker is one nothing can invalidate: when the code
    // grows the feature, the entry stays behind saying it has not. Every
    // entry that went stale was one of these.
    const unmarked = [...documented].filter(slug => !marked.has(slug)).sort();
    expect(unmarked).toEqual([]);
  });

  test('every marker in the code has an entry in the register', () => {
    const register = fs.readFileSync(REGISTER, 'utf8');
    const documented = new Set(
      ENTRY_ROWS.flatMap(pattern => [...slugsIn(register, pattern)]),
    );

    // The other direction, and the one that was missing. The register calls
    // itself "an index of what those markers say", which is a claim only this
    // check can keep true — without it a marker can be added and the index
    // silently not grow, which is how sixteen of them came to be absent while
    // the file still read as complete.
    const unindexed = [...markedSlugs()]
      .filter(slug => !documented.has(slug))
      .sort();
    expect(unindexed).toEqual([]);
  });
});
