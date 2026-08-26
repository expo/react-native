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
 * ## Why this RENDERS rather than reading the stylesheet
 *
 * It used to assert on `uaStyleFor('h1').marginBlock`, which was a length the
 * stylesheet had already multiplied out. It is not one any more: the size comes
 * from the platform, so the sheet states the spec's FACTOR (`uaMarginBlockEm`)
 * and the renderer multiplies. Reading the sheet would now check one of the two
 * operands and nothing about the multiplication — the half most likely to be
 * wrong, and the half no other test covers.
 *
 * So these mount headings and measure the boxes. Each sits alone inside a
 * BORDERED parent, because a border is what stops a margin collapsing through
 * the parent's edge (CSS 2.1 §8.3.1); without one the margin escapes upward and
 * the heading measures flush against its parent. With one, the heading's offset
 * from its parent IS its resolved top margin.
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
 * what the bug broke.
 *
 * ## What this host is
 *
 * Fantom has neither UIKit nor an Android theme, so nothing publishes a role
 * size and the renderer falls back to the font-size the cascade carried — which
 * here is the web ladder's, because the stylesheet states one where no platform
 * can answer. That fallback is the branch under test, and it is not a degraded
 * one: on a host with no platform to ask, the web's own answer is the correct
 * answer. The platform branch is pinned natively instead
 * (`EXPTextRoleMetricsTests`), because only a real UIKit can say what Title 1
 * measures.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import '@react-native/expo-intrinsics-poc';

import {uaStyleFor} from '../src/uaStyles';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ensureInstance from 'react-native/src/private/__tests__/utilities/ensureInstance';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

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

const BORDER = 1;

/**
 * The block margin the renderer resolved for `tag`, in points.
 *
 * `style` is merged onto the heading, for the tests that need an author's
 * declaration to be present.
 */
function renderedMargin(
  tag: string,
  style?: {[string]: unknown},
  inheritedFontSize?: number,
): number {
  const parentRef = createRef<unknown>();
  const headingRef = createRef<unknown>();
  const Tag: $FlowFixMe = tag;
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View
        collapsable={false}
        style={
          inheritedFontSize != null ? {fontSize: inheritedFontSize} : undefined
        }>
        <View
          collapsable={false}
          ref={parentRef}
          style={{borderWidth: BORDER, borderColor: '#000'}}>
          <Tag ref={headingRef} style={style}>
            {tag}
          </Tag>
        </View>
      </View>,
    );
  });

  const parent = ensureInstance(parentRef.current, ReactNativeElement);
  const heading = ensureInstance(headingRef.current, ReactNativeElement);
  // The heading's offset inside its parent, less the border that is holding the
  // margin in. What remains is the margin itself.
  return (
    heading.getBoundingClientRect().y -
    parent.getBoundingClientRect().y -
    BORDER
  );
}

/*
 * The root font size, recovered from what the renderer actually produced.
 *
 * h4 is the spec's 1em heading, so its margin is `1.33 × root` and nothing
 * else. The sheet cannot be asked instead — it states FACTORS now and holds no
 * root at all, which is the point: one copy of that number, in the renderer.
 */
let rootFontSize: ?number = null;
function ROOT_(): number {
  // Memoised, not module-scope: rendering at import time runs before the test
  // environment has a surface to render into, and every ref comes back null.
  if (rootFontSize == null) {
    rootFontSize = renderedMargin('h4') / 1.33;
  }
  return rootFontSize;
}

test('the root is a real, positive size', () => {
  expect(ROOT_()).toBeGreaterThan(0);
});

test('the sheet states the spec’s size factors, unresolved', () => {
  // A FACTOR, not a length: `h1 { font-size: 2em }` is the size the heading
  // INHERITED, doubled, and only the renderer knows what that was.
  for (const [tag, sizeEm] of SPEC) {
    expect(Number(uaStyleFor(tag).uaFontSizeEm)).toBeCloseTo(sizeEm, 4);
  }
});

test('the rendered margin is the spec’s figure times the heading’s own size', () => {
  for (const [tag, sizeEm, marginEm] of SPEC) {
    const own = sizeEm * ROOT_();
    // The property under test: margin = spec figure × THIS element's size.
    // To within half a point: layout is snapped to the device pixel grid, so a
    // 21.44pt margin is laid out as 21.33 at a 3x scale factor. Tighter than
    // that is asserting the snapping, not the arithmetic.
    expect(renderedMargin(tag)).toBeCloseTo(marginEm * own, 0);
    // And, stated separately so a failure says which half is wrong: the same
    // figure times the ROOT is the bug, and must NOT be what we produce —
    // except for h4, where the two are the same number and always were.
    if (sizeEm !== 1) {
      expect(renderedMargin(tag)).not.toBeCloseTo(marginEm * ROOT_(), 0);
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
  const margins = SPEC.map(([tag]) => renderedMargin(tag));
  expect(Math.max(...margins) - Math.min(...margins)).toBeLessThan(
    0.45 * ROOT_(),
  );

  // And specifically: h1 must not be the tightest heading on the page.
  expect(renderedMargin('h1')).toBeGreaterThan(renderedMargin('h3'));
});

test('an author’s margin wins', () => {
  /*
   * The precedence a user-agent stylesheet has, and the reason the factor is a
   * property of its own rather than a `marginBlock` the renderer overwrites.
   *
   * An author writes `marginBlock`; the sheet writes `uaMarginBlockEm`. Because
   * they are different properties the renderer can see that the author has
   * spoken and leave the element alone — which merging both into one `style`
   * makes impossible, since by then a UA value and an author's are the same
   * bytes in the same slot.
   */
  expect(renderedMargin('h1', {marginBlock: 3})).toBeCloseTo(3, 0);
  expect(renderedMargin('h1', {marginTop: 7})).toBeCloseTo(7, 0);
  // Zero is a stated value, not an absent one: `margin-block: 0` has to mean
  // no margin, and a truthiness check here would silently restore the default.
  expect(renderedMargin('h1', {marginBlock: 0})).toBeCloseTo(0, 0);
});

test('an element with no factor is untouched', () => {
  // The rule reaches every view in the tree, so the case that must not change
  // is the overwhelmingly common one: a plain element with no heading margin
  // gets no margin invented for it.
  expect(renderedMargin('div')).toBeCloseTo(0, 0);
  expect(renderedMargin('span')).toBeCloseTo(0, 0);
});

/*
 * `em` compounds. Both of a heading's `em` values resolve against a size an
 * ancestor can move, and this is what the sheet could not express while it was
 * multiplying them out here: the product it sent was `factor × root`, which is
 * `rem`, and a heading inside a restyled container stayed at the root's size
 * while the text around it grew.
 *
 * The chain under test, for `h1` in a 20pt container (css-values-4 §5.1.1):
 *
 *   inherited size   20            ← the container's `fontSize`
 *   own size         2 × 20 = 40   ← `font-size: 2em`, against the INHERITED size
 *   margin           0.67 × 40     ← `margin-block: 0.67em`, against its OWN
 *
 * The two `em`s multiply DIFFERENT sizes one step apart, so a test that only
 * checked the final number against `0.67 × 2 × root` would pass with both of
 * them wrong. Each row below moves the inherited size and asserts the whole
 * chain moved with it.
 */
test('a heading’s em resolves against the size it inherits, and its margin against the result', () => {
  for (const inherited of [10, 20, 32]) {
    for (const [tag, sizeEm, marginEm] of SPEC) {
      const own = sizeEm * inherited;
      expect(renderedMargin(tag, undefined, inherited)).toBeCloseTo(
        marginEm * own,
        0,
      );
    }
  }
});

test('a heading in a restyled container does not stay at the root’s size', () => {
  /*
   * The bug in one assertion. `rem` and `em` agree exactly when the inherited
   * size IS the root, so the only way to tell them apart is to make it
   * something else — and then the margin has to follow.
   */
  const inherited = 2 * ROOT_();
  const atRoot = renderedMargin('h1');
  const nested = renderedMargin('h1', undefined, inherited);

  expect(nested).toBeCloseTo(2 * atRoot, 0);
  expect(nested).not.toBeCloseTo(atRoot, 0);
});
