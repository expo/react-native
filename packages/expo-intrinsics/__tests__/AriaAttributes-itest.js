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
 * ARIA attributes reach the platform.
 *
 * They did not. Nothing anywhere translated `aria-*` — not the elements, not
 * the view configs, not the C++ props — so every one of them was accepted
 * without complaint and dropped, which is the worst way for an accessibility
 * attribute to fail: the app looks right, the code looks right, and a screen
 * reader says the wrong thing. It was found because a menu row whose visible
 * content began with a decorative glyph announced itself as `≡ Add fifty
 * messages` even with `aria-label` set.
 *
 * ## What can be asserted here, and what cannot
 *
 * Fantom's mounted props carry layout and a *little* else — notably
 * `importantForAccessibility`, which is the one accessibility signal that
 * reaches the rendered output. The name, the role and `accessible` do not, so
 * `aria-label` cannot be checked from here at all.
 *
 * It is checked, though. `packages/chat-demo/ios/uitests/ControlCheck`
 * looks its rows up by name and those rows are labelled ONLY in ARIA, so it
 * fails the moment this stops working — which is how the bug was found, with
 * exactly that test reporting `the panel never offered Add a row`.
 */

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

function mounted(element: React.MixedElement): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(element);
  });
  // `?? ''` because `JSON.stringify` is typed as possibly returning void; an
  // empty string fails every assertion below, which is the right answer if the
  // output ever really is nothing.
  return (
    JSON.stringify(
      root.getRenderedOutput({props: ['importantForAccessibility']}).toJSX(),
    ) ?? ''
  );
}

test('aria-hidden takes an element out of the accessibility tree', () => {
  // `no-hide-descendants` rather than `no`: the attribute means "me and
  // everything inside me", and the two spellings are different behaviours.
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<div aria-hidden={true} />)).toContain('no-hide-descendants');
});

test('aria-hidden={false} leaves it alone', () => {
  // The pair most likely to be collapsed. `false` is not "hide": it is the
  // author saying the element is NOT hidden, which is the default.
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<div aria-hidden={false} />)).not.toContain(
    'no-hide-descendants',
  );
});

test('an element with no aria-hidden is untouched', () => {
  // The case that would still pass if the feature were deleted, kept as the
  // baseline the two above are read against.
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<div />)).not.toContain('no-hide-descendants');
});

test('it works on a control-backed element too, not just a box', () => {
  /*
   * Every element props class calls the same helper, and they are twelve
   * separate constructors — so one of them being wired up says nothing about
   * the others. `<button>` is the one with user-agent accessibility defaults
   * of its own, which is where a conflict would show first.
   */
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<button aria-hidden={true} />)).toContain(
    'no-hide-descendants',
  );
});
