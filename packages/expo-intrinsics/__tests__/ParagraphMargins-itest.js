/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * @flow strict-local
 * @format
 */

/**
 * `<p>`'s block margin stays a shorthand so an author can override it.
 * `applyAliasedProps` gives `marginBlock` precedence and fills the longhands
 * only when their edges are undefined, so a user-agent longhand would beat an
 * author `marginBlock: 0`. DOM-CSS-LIMITATION(paragraph-margin-shorthand-dropped)
 * is the device-only gap this shape leaves open; Fantom measures the correct
 * gap either way and tests the declaration's shape.
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
