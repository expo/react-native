/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * A heading's `em` margins resolve against ITS OWN font-size, not the root's.
 *
 * `html.css` gives the heading margins in `em` — `h1 { margin-block: 0.67em }`
 * — and a margin's `em` is the element's own computed font-size. A heading is
 * the one place in the UA sheet where that distinction bites, because a heading
 * is also the one place where the font-size is not 1em.
 *
 * Multiplying the spec's figure by the ROOT em gets h4 right by luck (h4 is
 * 1em) and everything else wrong in *both directions at once*: h1 and h2 land
 * at roughly half their margin, h5 and h6 at 20–50% too much. On screen that is
 * an h1 crowding whatever precedes it while the small headings drift apart —
 * which looks like a margin-collapsing fault, and sends you to the wrong file.
 *
 * ## Why this asserts ratios and not points
 *
 * The obvious test pins Safari's numbers: 21.44, 19.91, 18.72 and so on, read
 * off `getComputedStyle` for a 16px root. Those are the right numbers to have
 * checked the fix against, and they are wrong to assert here, because this
 * stylesheet is deliberately NOT 16px-rooted — the root is the platform's body
 * text size, so every absolute value differs per platform by design. A test
 * written against the points would fail on iOS for the one reason that is not a
 * bug.
 *
 * What survives the root changing is the *relationship*, which is also exactly
 * what the bug broke. The factors below are the spec's, and Safari's measured
 * values are what confirmed each pair — recorded in the table so the derivation
 * stays checkable rather than becoming folklore.
 */

import {uaStyleFor} from '../src/uaStyles';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

/**
 * tag → [font-size in em, margin-block in em].
 *
 * Both columns are from `html.css`. The third and fourth are what real Safari
 * computes at a 16px root (via safaridriver + `getComputedStyle`), kept as the
 * evidence that these factors are the right ones:
 *
 *   h1  2em    0.67em   → 32px    21.44px
 *   h2  1.5em  0.83em   → 24px    19.91px
 *   h3  1.17em 1em      → 18.72px 18.72px
 *   h4  1em    1.33em   → 16px    21.27px
 *   h5  0.83em 1.67em   → 13.28px 22.17px
 *   h6  0.67em 2.33em   → 10.72px 24.97px
 */
const SPEC: ReadonlyArray<[string, number, number]> = [
  ['h1', 2, 0.67],
  ['h2', 1.5, 0.83],
  ['h3', 1.17, 1.0],
  ['h4', 1, 1.33],
  ['h5', 0.83, 1.67],
  ['h6', 0.67, 2.33],
];

// The root this sheet is built on, recovered from h4 — the heading the spec
// puts at exactly 1em. Reading it back rather than importing a constant keeps
// the test honest about what the stylesheet actually produced.
const ROOT = Number(uaStyleFor('h4').fontSize);

test('the root is a real, positive size', () => {
  expect(ROOT).toBeGreaterThan(0);
});

test('heading font sizes are the spec’s multiples of the root', () => {
  for (const [tag, sizeEm] of SPEC) {
    expect(Number(uaStyleFor(tag).fontSize)).toBeCloseTo(sizeEm * ROOT, 4);
  }
});

test('heading margins resolve against the heading’s own font-size', () => {
  for (const [tag, sizeEm, marginEm] of SPEC) {
    const own = Number(uaStyleFor(tag).fontSize);
    // The property under test: margin = spec figure × THIS element's size.
    expect(Number(uaStyleFor(tag).marginBlock)).toBeCloseTo(marginEm * own, 4);
    // And, stated separately so a failure says which half is wrong: the same
    // figure times the ROOT is the bug, and must NOT be what we produce —
    // except for h4, where the two are the same number and always were.
    if (sizeEm !== 1) {
      expect(Number(uaStyleFor(tag).marginBlock)).not.toBeCloseTo(
        marginEm * ROOT,
        4,
      );
    }
  }
});

test('the margin scales with the heading, not against it', () => {
  /*
   * The shape of the bug, independent of any number: h1 has the largest text
   * and the *smallest* spec figure (0.67em), so multiplying by a fixed root em
   * makes h1's margin the smallest of the six. Resolved correctly it is not —
   * all six land within a few points of each other, which is the whole point of
   * the em scale.
   */
  const margins = SPEC.map(([tag]) => Number(uaStyleFor(tag).marginBlock));
  expect(Math.max(...margins) - Math.min(...margins)).toBeLessThan(0.45 * ROOT);

  // And specifically: h1 must not be the tightest heading on the page.
  expect(Number(uaStyleFor('h1').marginBlock)).toBeGreaterThan(
    Number(uaStyleFor('h3').marginBlock),
  );
});
