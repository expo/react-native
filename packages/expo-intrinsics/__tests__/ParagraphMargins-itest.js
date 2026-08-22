/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * @flow strict-local
 * @format
 */

/**
 * `<p>`'s block margin must stay a SHORTHAND, so an author can override it.
 *
 * This file previously asserted the opposite. `<p>` gets no vertical margin on
 * either device when the user-agent sheet uses `marginBlock`
 * (`DOM-CSS-LIMITATION(paragraph-margin-shorthand-dropped)`), and writing the
 * longhands instead restored the gap — so the longhands went in and this test
 * was written to hold them there.
 *
 * That was a bad trade, and the shape of it is worth keeping.
 *
 * `applyAliasedProps` gives `marginBlock` precedence — it sets `Edge::Vertical`
 * unconditionally — while `marginBlockStart`/`marginBlockEnd` only fill
 * `Edge::Top`/`Bottom` when those are still undefined. A user-agent longhand
 * therefore beats an AUTHOR shorthand: `<p style={{marginBlock: 0}}>` sets
 * Vertical to 0, leaves Top and Bottom undefined, and the user-agent's 16pt
 * fills them in afterwards. The cascade runs backwards.
 *
 * So the workaround bought a visible gap by making the user-agent default
 * unoverridable on the most-restyled element in HTML. A default nobody can
 * override is a worse defect than a default that is missing, and it is the kind
 * that surfaces in someone else's app rather than in our demo.
 *
 * The margin gap is a real bug and is still open. It is NOT this file's job:
 * Fantom measures the correct gap either way and cannot see it at all. What
 * Fantom can see — and what this file exists for — is the declaration's shape,
 * which is what decides whether the cascade works.
 */

import {uaStyleFor} from '../src/uaStyles';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

test('a paragraph declares a block margin at all', () => {
  expect(Number(uaStyleFor('p').marginBlock)).toBeGreaterThan(0);
});

test('it is the shorthand, so an author declaration can win', () => {
  /*
   * The specific regression: longhands here are silently unoverridable. See
   * `DomElementsCatalog-itest`'s "an author style beats the UA default", which
   * measures the consequence; this asserts the cause, because the cause is a
   * one-line edit that looks harmless.
   */
  const p = uaStyleFor('p');
  expect(p.marginBlockStart).toBeUndefined();
  expect(p.marginBlockEnd).toBeUndefined();
});

test('the other block elements use the shorthand too', () => {
  // Scope: `<p>` is not special, and should not drift away from its neighbours.
  for (const tag of ['blockquote', 'figure', 'dl']) {
    expect(Number(uaStyleFor(tag).marginBlock)).toBeGreaterThan(0);
    expect(uaStyleFor(tag).marginBlockStart).toBeUndefined();
  }
});
