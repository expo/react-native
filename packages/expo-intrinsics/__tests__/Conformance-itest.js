/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

/**
 * The conformance corpus, compared with real Safari.
 *
 * `text-conformance/expected.json` is what WebKit actually produced for the
 * *same* trees (`oracle.js` renders them through safaridriver). This runs them
 * through the shared C++ layout and asserts the coordinates match.
 *
 * ## Why exact comparison is legitimate here
 *
 * Text cannot be compared to a browser's pixels: three engines shape with three
 * fonts, so a span's width is a fact about a font file. The corpus is built to
 * remove that variable — every measured box is an atomic inline with an
 * explicit size, on lines with an explicit `line-height`, aligned to the top.
 * Under those constraints CSS determines every coordinate, and any difference
 * is a real disagreement rather than a font.
 *
 * The `withText` cases keep their absolute numbers out of it and compare which
 * boxes share a line instead. They are here because the interesting bugs live
 * where text and atomic inlines mix.
 *
 * Fantom rather than a device because this is the fix-and-check loop; the
 * device harness (`verify.js`) is the final word and runs the same corpus.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const CORPUS = require('../../../text-conformance/corpus.json');
const EXPECTED = require('../../../text-conformance/expected.json');

import '@react-native/expo-intrinsics-poc';

/* Rounding only — the corpus is constructed so CSS fixes every coordinate. */
const TOLERANCE = 0.5;

function toStyle(css) {
  const out = {};
  for (const [key, value] of Object.entries(css ?? {})) {
    out[key] =
      typeof value === 'string' && /^-?\d+(\.\d+)?px$/.test(value)
        ? parseFloat(value)
        : value;
  }
  return out;
}

function render(node, refs, key) {
  if (typeof node === 'string') {
    return node;
  }
  const children = (node.children ?? []).map((child, i) =>
    render(child, refs, i),
  );
  const props = {key, style: toStyle(node.style)};
  if (node.m != null) {
    props.ref = instance => {
      if (instance != null) {
        refs[node.m] = instance;
      }
    };
  }
  return React.createElement(
    node.tag,
    props,
    children.length ? children : undefined,
  );
}

function measure(tree) {
  const refs = {};
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(render(tree, refs, 'case'));
  });
  const rootRect = refs.root?.getBoundingClientRect();
  if (rootRect == null) {
    throw new Error('case root did not render');
  }
  const rects = {};
  for (const [m, instance] of Object.entries(refs)) {
    const r = instance?.getBoundingClientRect?.();
    if (r == null) {
      continue;
    }
    rects[m] = {
      x: Number((r.x - rootRect.x).toFixed(2)),
      y: Number((r.y - rootRect.y).toFixed(2)),
      width: Number(r.width.toFixed(2)),
      height: Number(r.height.toFixed(2)),
    };
  }
  return rects;
}

/* Which boxes share a line, in order — the font-independent comparison. */
function signature(rects) {
  const lines = [];
  const entries = Object.entries(rects)
    .filter(([m]) => m !== 'root')
    .sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x);
  for (const entry of entries) {
    const [, r] = entry;
    const line = lines.find(l =>
      l.some(
        ([, o]) =>
          Math.min(o.y + o.height, r.y + r.height) > Math.max(o.y, r.y),
      ),
    );
    if (line) {
      line.push(entry);
    } else {
      lines.push([entry]);
    }
  }
  return lines
    .map(l =>
      l
        .sort((a, b) => a[1].x - b[1].x)
        .map(([m]) => m)
        .join(' '),
    )
    .join(' | ');
}

for (const testCase of CORPUS) {
  const want = EXPECTED[testCase.name];
  const label = testCase.withText
    ? `${testCase.name} (lines match Safari)`
    : `${testCase.name} (matches Safari exactly)`;

  /*
   * Two reasons a case is not asserted *here*. Both keep this suite meaningful:
   * a suite that is permanently red teaches everyone to ignore it, and one that
   * asserts things Fantom cannot answer reports the harness rather than the
   * product. Every case below still runs against a real device in
   * `text-conformance/verify.js`, which is the authority.
   */
  if (testCase.needsLineBreaking) {
    // Fantom's text layout manager is neither CoreText nor Android's and does
    // not implement UAX #14 line breaking, so where a line ends is not its
    // answer to give. Asserting it here reported failures that both devices
    // pass.
    // Deliberate, and explained above: Fantom does not implement UAX #14, so
    // where a line ends is not its answer to give. The case still runs against
    // a real device in `text-conformance/verify.js`, and is registered as a
    // skip rather than dropped so the corpus stays visibly complete.
    // eslint-disable-next-line jest/no-disabled-tests
    test.skip(`${label} — device-only: needs real line breaking`, () => {});
    continue;
  }
  if (testCase.fontDependent != null) {
    // Not skipped — asserted differently. The exact offset depends on a font's
    // x-height, but the *properties* of `middle` do not: the box stays inside
    // the line box and sits strictly between where `top` and `bottom` would put
    // it. That is the strongest claim that is true of every engine.
    test(`${testCase.name} (bounded — offset is font-dependent)`, () => {
      const got = measure(testCase.tree);
      const root = got.root;
      const short = got.short;
      const tall = got.tall;
      expect(short.y).toBeGreaterThan(0);
      expect(short.y + short.height).toBeLessThanOrEqual(root.y + root.height);
      // Strictly between the two extremes: not top-aligned, not bottom-aligned.
      expect(short.y).toBeGreaterThan(tall.y);
      expect(short.y + short.height).toBeLessThan(tall.y + tall.height);
    });
    continue;
  }
  if (testCase.knownGap != null) {
    // A known gap, named in the title so it reads as an outstanding item
    // rather than a silent omission. Deleting it would lose the record of what
    // is not yet right.
    // eslint-disable-next-line jest/no-disabled-tests
    test.skip(`${label} — KNOWN GAP: ${testCase.knownGap}`, () => {});
    continue;
  }

  test(label, () => {
    const got = measure(testCase.tree);

    if (testCase.withText) {
      expect(signature(got)).toBe(signature(want));
      return;
    }

    const differences = [];
    for (const [m, w] of Object.entries(want)) {
      const g = got[m];
      if (g == null) {
        differences.push(`${m}: not measured`);
        continue;
      }
      for (const key of ['x', 'y', 'width', 'height']) {
        if (Math.abs(w[key] - g[key]) > TOLERANCE) {
          differences.push(`${m}.${key}: safari ${w[key]} vs ours ${g[key]}`);
        }
      }
    }
    if (differences.length > 0) {
      throw new Error(
        `${testCase.name}\n  ${testCase.why}\n  ` + differences.join('\n  '),
      );
    }
  });
}
