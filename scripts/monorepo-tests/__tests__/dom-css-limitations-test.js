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
 * `dom-css-limitations.md` says it cannot drift out of date because every
 * limitation is marked at the code that has it; this check is what makes that
 * true in both directions.
 */

const REGISTER = path.join(REPO_ROOT, 'dom-css-limitations.md');

/*
 * The convention: `DOM-CSS-LIMITATION(slug)` or `DOM-CSS-DEVIATION(slug)` in a
 * comment beside the code, and a register row whose bolded lead-in names the
 * same slug. `slug` itself is the placeholder in the register's own explanation.
 * Only rows in the two shapes below are limitations; informational rows name
 * nothing in the code.
 */
const MARKER = /DOM-CSS-(?:LIMITATION|DEVIATION)\(([a-z0-9-]+)\)/g;
const ENTRY_ROWS = [
  /^\*\*`([a-z0-9-]+)`\*\*/gm,
  /^- \*\*`DOM-CSS-LIMITATION\(([a-z0-9-]+)\)`/gm,
  // The index rows under "Every other marked divergence": slug, kind, file
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

    // An entry with no marker is one nothing can invalidate
    const unmarked = [...documented].filter(slug => !marked.has(slug)).sort();
    expect(unmarked).toEqual([]);
  });

  test('every marker in the code has an entry in the register', () => {
    const register = fs.readFileSync(REGISTER, 'utf8');
    const documented = new Set(
      ENTRY_ROWS.flatMap(pattern => [...slugsIn(register, pattern)]),
    );

    // The other direction: the register calls itself an index of the markers,
    // and a marker added without a row would leave it silently incomplete
    const unindexed = [...markedSlugs()]
      .filter(slug => !documented.has(slug))
      .sort();
    expect(unindexed).toEqual([]);
  });
});
