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
 * `alt` is THREE states, and the difference between them is invisible.
 *
 * Nothing here can be seen in a screenshot, which is exactly why it needed
 * pinning: an image whose `alt` handling regresses looks identical and simply
 * stops working for anyone using a screen reader.
 *
 *  - **text** — the image carries meaning. Labelled, with the image role.
 *  - **empty** — `alt=""` is the author saying *decorative*. The spec is
 *    explicit that it should then be ignored entirely, so it is HIDDEN from
 *    assistive technology rather than merely left unlabelled. Announcing
 *    "image" over a spacer is the noise the attribute exists to remove.
 *  - **absent** — no claim either way, left as the platform default. A validity
 *    error in HTML, not something to paper over.
 *
 * The empty and absent cases are the pair most likely to be collapsed into one
 * by a well-meaning refactor, and they are the two that differ most.
 */

import {accessibilityForAlt} from '../src/Img';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

/*
 * Asserted against the mapping directly, not against rendered output.
 *
 * The mounted props carry only `importantForAccessibility` — not the label,
 * the role, or `accessible` — so a render-based test can see the decorative
 * case and cannot tell a labelled image from an unlabelled one. A first
 * version of this file did exactly that and reported `undefined` for three of
 * four assertions. The rendered case below still checks the one signal that
 * does reach the view, so both halves are covered.
 */

const SRC = 'https://reactnative.dev/img/tiny_logo.png';

test('alt="text" labels the image and gives it the image role', () => {
  const a = accessibilityForAlt('The React Native logo');
  expect(a?.accessible).toBe(true);
  expect(a?.accessibilityRole).toBe('image');
  expect(a?.accessibilityLabel).toBe('The React Native logo');
});

test('alt="" hides the image from assistive technology entirely', () => {
  /*
   * Decorative. Not "unlabelled" — hidden. And hidden on BOTH platforms, which
   * spell "and not my children either" differently, so one spelling alone
   * leaves the image announced on the other platform.
   */
  const a = accessibilityForAlt('');
  expect(a?.accessible).toBe(false);
  expect(a?.accessibilityElementsHidden).toBe(true);
  expect(a?.importantForAccessibility).toBe('no-hide-descendants');
  // A decorative image must not also claim a role or a name.
  expect(a?.accessibilityRole).toBeUndefined();
  expect(a?.accessibilityLabel).toBeUndefined();
});

test('a missing alt makes no claim either way', () => {
  // The author forgot. A browser does not invent a label and neither do we —
  // inventing one would hide the authoring error behind plausible noise.
  expect(accessibilityForAlt(null)).toBeNull();
  expect(accessibilityForAlt(undefined)).toBeNull();
});

test('the empty and absent cases are NOT the same', () => {
  // The pair a refactor is most likely to collapse: one is a deliberate
  // "ignore me", the other is an omission, and they must not converge.
  expect(accessibilityForAlt('')).not.toBeNull();
  expect(accessibilityForAlt(null)).toBeNull();
});

test('a decorative image really is hidden once mounted', () => {
  // The half the view DOES carry, so the mapping is not the only thing tested:
  // `importantForAccessibility` reaches the mounted props and can be read back.
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    // $FlowExpectedError[not-a-component] intrinsic tag
    root.render(<img src={SRC} alt="" />);
  });
  const json = JSON.stringify(
    root.getRenderedOutput({props: ['importantForAccessibility']}).toJSX(),
  );
  expect(json).toContain('no-hide-descendants');
});
