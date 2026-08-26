/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * @flow strict-local
 * @format
 */

/**
 * `<p>`'s block margin must stay overridable by an author.
 *
 * This file has now held three different shapes for one declaration, and the
 * reason it keeps changing is worth more than any of them.
 *
 * 1. `marginBlock: <points>` — the original. `<p>`, and only `<p>`, lost its
 *    vertical margin on both devices, while `<dl>` kept a byte-identical
 *    declaration. `DOM-CSS-LIMITATION(paragraph-margin-shorthand-dropped)`.
 * 2. `marginBlockStart`/`marginBlockEnd` — restored the gap and inverted the
 *    cascade. `applyAliasedProps` gives `marginBlock` precedence (it sets
 *    `Edge::Vertical` unconditionally) while the longhands only fill
 *    `Edge::Top`/`Bottom` when those are still undefined. So a user-agent
 *    longhand BEAT an author's shorthand: `<p style={{marginBlock: 0}}>` set
 *    Vertical to 0, left Top and Bottom undefined, and the user-agent's 16pt
 *    filled them in afterwards. A default nobody can override is a worse
 *    defect than a default that is missing, so this was reverted.
 * 3. `uaMarginBlockEm` — the current shape, and the one with no contest to
 *    lose. The sheet's value is not A MARGIN AT ALL until the renderer resolves
 *    it, so it cannot collide with an author's in the aliasing table. The
 *    renderer checks for an author's block margin explicitly and writes nothing
 *    when it finds one.
 *
 * The through-line: every version of this bug came from the user-agent value
 * and the author's value being the same property. Giving the sheet a channel of
 * its own is what makes the precedence expressible rather than emergent.
 *
 * Whether shape 3 also closes the device gap is not something this file can
 * say — Fantom measures the correct gap under all three. The limitation marker
 * stays until a device says otherwise.
 *
 * This also corrects the UNIT. `html.css` says `p { margin-block: 1em }`, and
 * `em` there is the element's OWN computed font size. Shapes 1 and 2 sent the
 * ROOT's size, which is `rem` — indistinguishable at the top of a document and
 * wrong inside anything that had restyled its text.
 */

import {uaStyleFor} from '../src/uaStyles';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

test('a paragraph declares a block margin at all', () => {
  expect(Number(uaStyleFor('p').uaMarginBlockEm)).toBeGreaterThan(0);
});

test('it is the spec’s em factor, not a resolved length', () => {
  // `html.css`'s own figure. A length here would be a `rem` wearing an `em`'s
  // name, because the only size this file could multiply by is the root's.
  expect(Number(uaStyleFor('p').uaMarginBlockEm)).toBe(1);
});

test('the sheet writes no property an author would write', () => {
  /*
   * The precedence, asserted as the property split that makes it possible.
   * An author writes `marginBlock` (or a longhand); the sheet writes
   * `uaMarginBlockEm`. Because they are different properties, the renderer can
   * see which of the two spoke — which is exactly what shapes 1 and 2 could
   * not do, since by then both values were the same bytes in the same slot.
   *
   * `DomElementsCatalog-itest`'s "an author style beats the UA default"
   * measures the consequence; this asserts the cause, because the cause is a
   * one-line edit that looks harmless.
   */
  const p = uaStyleFor('p');
  expect(p.marginBlock).toBeUndefined();
  expect(p.marginBlockStart).toBeUndefined();
  expect(p.marginBlockEnd).toBeUndefined();
  expect(p.marginTop).toBeUndefined();
  expect(p.marginBottom).toBeUndefined();
  expect(p.margin).toBeUndefined();
});

test('the other block elements are declared the same way', () => {
  // Scope: `<p>` is not special, and should not drift away from its neighbours.
  // All of these are `1em` in `html.css`.
  for (const tag of ['blockquote', 'figure', 'pre', 'menu', 'ul', 'ol', 'dl']) {
    expect(Number(uaStyleFor(tag).uaMarginBlockEm)).toBe(1);
    expect(uaStyleFor(tag).marginBlock).toBeUndefined();
    expect(uaStyleFor(tag).marginBlockStart).toBeUndefined();
  }
});
