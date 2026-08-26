/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {uaStyleFor} from '../src/uaStyles';

/*
 * Headings name a platform ROLE, and state the web's answer beside it.
 *
 * The point of the role is that this file does not know how big a heading is.
 * `[UIFont preferredFontForTextStyle:]` knows, and answers with the weight and
 * the leading as well; a stylesheet that wrote 28pt semibold would be copying
 * today's answer and would keep giving it after the platform had moved on.
 *
 * What it DOES state is the web's own size and weight, in `uaFontSizeEm` and
 * `uaFontWeight` — the user-agent origin channel. Those are used only where the
 * role resolves to nothing, and they are stated unconditionally, on every host.
 *
 * The size is a FACTOR, not a length. `h1 { font-size: 2em }` resolves against
 * the size the heading INHERITED (css-values-4 §5.1.1), which this file cannot
 * know either — so, like the role, it is stated and resolved elsewhere. It was
 * a length once, pre-multiplied by the root, which is `rem`: the same number
 * for a heading at the top of a document and the wrong one inside anything that
 * had restyled its text.
 * That combination is the thing to protect:
 *
 *  - a `fontSize` creeping back in is the regression. It is the property an
 *    AUTHOR writes, so it would beat the platform's role on every device, and
 *    would still look right on the day it was added;
 *  - a host CHECK creeping back in is the other one. This file used to ask
 *    whether it was running under the test runner, because a stated size was
 *    indistinguishable from an author's. With a channel of its own it states
 *    the size always and the renderer decides — so the declarations below are
 *    the same on iOS, on Android and under Fantom.
 */
describe('headings name a platform role rather than a size', () => {
  const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  test.each(LEVELS)('%s states no author-channel font size', level => {
    // The regression: `fontSize` is the author's property, and a user-agent
    // value in it beats the platform's role everywhere.
    expect(uaStyleFor(level).fontSize).toBeUndefined();
  });

  test.each(LEVELS)(
    '%s states the web ladder in the user-agent channel',
    level => {
      const style = uaStyleFor(level);
      expect(typeof style.uaFontSizeEm).toBe('number');
      expect(style.uaFontSizeEm).toBeGreaterThan(0);
      expect(style.uaFontWeight).toBe('bold');
    },
  );

  test('the user-agent sizes are the web ladder, in order', () => {
    // `html.css`'s own factors, unresolved and strictly decreasing — the shape
    // a collapsed or half-applied ladder would lose.
    const factors = LEVELS.map(level => Number(uaStyleFor(level).uaFontSizeEm));
    for (let i = 1; i < factors.length; i++) {
      expect(factors[i]).toBeLessThan(factors[i - 1]);
    }
    expect(factors).toEqual([2, 1.5, 1.17, 1, 0.83, 0.67]);
  });

  test('no level states a resolved size', () => {
    /*
     * The regression that stating factors exists to prevent: any number here
     * large enough to be a point size means someone multiplied by a root, and
     * a root multiplied in this file is a `rem`. The ladder tops out at 2, so
     * the two cannot be confused.
     */
    for (const level of LEVELS) {
      expect(Number(uaStyleFor(level).uaFontSizeEm)).toBeLessThanOrEqual(2);
      expect(uaStyleFor(level).uaFontSize).toBeUndefined();
    }
  });

  test('h1 through h4 take the four roles iOS has above body text', () => {
    // Title 1, 2, 3 and Headline. There is no fifth: the scale runs out, which
    // is why h5 and h6 are handled separately below.
    expect(uaStyleFor('h1').dynamicTypeRamp).toBe('title1');
    expect(uaStyleFor('h2').dynamicTypeRamp).toBe('title2');
    expect(uaStyleFor('h3').dynamicTypeRamp).toBe('title3');
    expect(uaStyleFor('h4').dynamicTypeRamp).toBe('headline');
  });

  test('h1 through h4 state no author-channel weight either', () => {
    // The platform's own shape: every Title is regular and Headline is
    // semibold, so weight comes with the role. `bold` IS stated, in the
    // user-agent channel above, and is used only where no role resolves —
    // stating it here instead would override the platform on exactly the
    // elements the role exists to style.
    for (const level of ['h1', 'h2', 'h3', 'h4']) {
      expect(uaStyleFor(level).fontWeight).toBeUndefined();
    }
  });

  test('h5 and h6 borrow a secondary role and state a weight', () => {
    // The one deliberate departure. Subheadline and Footnote are secondary-text
    // roles delivered regular, and a heading at that size and weight stops
    // reading as a heading — so the SIZE is still the platform's and only the
    // weight is ours. A stated weight is a design decision; a stated size would
    // be a copied metric.
    expect(uaStyleFor('h5').dynamicTypeRamp).toBe('subheadline');
    expect(uaStyleFor('h6').dynamicTypeRamp).toBe('footnote');
    expect(uaStyleFor('h5').fontWeight).toBe('600');
    expect(uaStyleFor('h6').fontWeight).toBe('600');
  });

  test('every level states a margin FACTOR and no margin length', () => {
    // The margin cannot be multiplied out here for the same reason the size
    // cannot be stated here: neither is known until the platform answers. So
    // the spec's `em` figure travels as a factor and the renderer resolves it
    // against the size the heading is actually drawn at.
    //
    // The absence of `marginBlock` is half the assertion. A length creeping
    // back in would look right at the default text size, be wrong at every
    // other one, and — because it is the property an AUTHOR writes — would also
    // start winning against an author's own margin.
    for (const level of LEVELS) {
      const style = uaStyleFor(level);
      expect(typeof style.uaMarginBlockEm).toBe('number');
      expect(style.uaMarginBlockEm).toBeGreaterThan(0);
      expect(style.marginBlock).toBeUndefined();
    }
  });

  test("the margin factors are the spec's own figures", () => {
    // Straight from `html.css`. Written out rather than derived, because the
    // point of the change was to stop deriving them from anything: these are
    // the web's ratios and only the size they multiply is the platform's.
    expect(LEVELS.map(level => uaStyleFor(level).uaMarginBlockEm)).toEqual([
      0.67, 0.83, 1.0, 1.33, 1.67, 2.33,
    ]);
  });
});
