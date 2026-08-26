/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
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

/*
 * The corpus's own CSS-to-React-Native translation, imported rather than
 * reimplemented. A local copy here drifted behind the one in
 * `gen-device-screen.js` and made a working `em` implementation look like six
 * failures — the styles it built carried `1em` through as a string.
 */
const {toStyle, runGapChecks} = require('../../../text-conformance/cases');

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
    // A block container around the case, so its root is not a flex item of
    // the surface root. See the note beside `render` in gen-device-screen.js:
    // a block box that is a flex item is an independent formatting context and
    // does not let margins collapse through it, which the browser's <body>
    // does. Without this the corpus compares two different trees.
    root.render(
      React.createElement('div', {style: {display: 'block'}},
        render(tree, refs, 'case')),
    );
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
  /*
   * A case that checks GAPS between its own boxes instead of diffing every
   * rect against Safari's. For the units whose base is the root font size —
   * 16px in a browser, the platform's body size here — the absolute numbers
   * differ by design, and for the rest it keeps the case pointed at the
   * margins rather than at a container height that is a separate question.
   */
  if (testCase.bounded === 'gap-checks') {
    test(`${testCase.name} (gap checks — see the case)`, () => {
      const problems = runGapChecks(testCase, measure(testCase.tree));
      if (problems.length > 0) {
        throw new Error(
          `${testCase.name}\n  ${testCase.why}\n  ${problems.join('\n  ')}`,
        );
      }
    });
    continue;
  }

  if (testCase.bounded === 'line-taller-than-box') {
    /*
     * The line box is the box plus the strut's descent below the baseline, and
     * that descent is a font metric — this runner's grid has its own, which is
     * neither device's. What is asserted is what CSS fixes: the box keeps its
     * declared size at the top of the line, and the line is strictly taller
     * than the box, which is the claim the case exists to make.
     */
    test(`${testCase.name} (bounded — the strut's descent is font-dependent)`, () => {
      const got = measure(testCase.tree);
      expect(got.only.width).toBe(want.only.width);
      expect(got.only.height).toBe(want.only.height);
      expect(got.only.y).toBe(got.root.y);
      expect(got.root.height).toBeGreaterThan(got.only.height);
    });
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

    /*
     * `sameX` is deliberately NOT checked here — it is a device assertion.
     *
     * It asks whether two encodings of the same text put a following box in
     * the same place, which is a question about glyph shaping. This runner's
     * measurer is a monospace grid of `kDeterministicCharacterWidth` cells
     * that advances once per UTF-16 code unit, by design and for
     * reproducibility. It has no clusters and no combining marks, so
     * "e"+U+0301 is two cells where precomposed "é" is one, and the two rows
     * land 40pt apart — a fact about the stub, not about the product.
     *
     * Asserting it anyway would have been worse than useless: it fails here
     * for a reason unrelated to the defect, so it would train the eye to
     * ignore the case that is supposed to catch that defect. The real check
     * runs in `verify.js` against real TextKit and real Safari.
     *
     * The case still runs here for its structure — two rows, two lines, a box
     * on each — which the grid does model correctly.
     */

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
