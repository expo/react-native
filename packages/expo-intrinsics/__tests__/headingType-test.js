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
 * Headings name a platform ROLE and state no size.
 *
 * The point of the role is that this file does not know how big a heading is.
 * `[UIFont preferredFontForTextStyle:]` knows, and answers with the weight and
 * the leading as well; a stylesheet that wrote 28pt semibold would be copying
 * today's answer and would keep giving it after the platform had moved on.
 *
 * So these tests assert the ABSENCE of a size as firmly as the presence of a
 * role. A `fontSize` creeping back in is the regression — it would still look
 * right on the day it was added, which is exactly why nothing else would catch
 * it.
 *
 * Jest reports `Platform.OS` as `ios`, which is the platform that has roles.
 */
describe('headings name a platform role rather than a size', () => {
  const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

  test.each(LEVELS)('%s states no font size', level => {
    expect(uaStyleFor(level).fontSize).toBeUndefined();
  });

  test('h1 through h4 take the four roles iOS has above body text', () => {
    // Title 1, 2, 3 and Headline. There is no fifth: the scale runs out, which
    // is why h5 and h6 are handled separately below.
    expect(uaStyleFor('h1').dynamicTypeRamp).toBe('title1');
    expect(uaStyleFor('h2').dynamicTypeRamp).toBe('title2');
    expect(uaStyleFor('h3').dynamicTypeRamp).toBe('title3');
    expect(uaStyleFor('h4').dynamicTypeRamp).toBe('headline');
  });

  test('h1 through h4 state no weight either', () => {
    // The platform's own shape: every Title is regular and Headline is
    // semibold, so weight comes with the role. Stating `bold` on all six is the
    // browser's convention and the clearest way to make a document look like a
    // web page on a phone.
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

  test('every level still carries its own margins', () => {
    // The sizes left, the margins did not: `em` in a margin resolves against
    // the element's own font-size, which this file no longer knows, so these
    // still follow the web ladder. Recorded as a limitation in uaStyles.js —
    // pinned here so it stays a known gap rather than becoming a silent one.
    const margins = LEVELS.map(level => uaStyleFor(level).marginBlock);
    for (const margin of margins) {
      expect(typeof margin).toBe('number');
      expect(margin).toBeGreaterThan(0);
    }
  });
});
