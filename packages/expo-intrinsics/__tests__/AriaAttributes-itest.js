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
 * ARIA attributes reach the platform. Fantom's mounted props carry
 * `importantForAccessibility` but not the name, the role or `accessible`, so
 * `aria-label` is checked on device instead, by the UI tests that look rows up
 * by names given only in ARIA.
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
  // `JSON.stringify` is typed as possibly returning void; an empty string fails
  // every assertion below
  return (
    JSON.stringify(
      root.getRenderedOutput({props: ['importantForAccessibility']}).toJSX(),
    ) ?? ''
  );
}

test('aria-hidden takes an element out of the accessibility tree', () => {
  // `no-hide-descendants` rather than `no`: the attribute hides the subtree too
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<div aria-hidden={true} />)).toContain('no-hide-descendants');
});

test('aria-hidden={false} leaves it alone', () => {
  // `false` is the author saying the element is not hidden, the default
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<div aria-hidden={false} />)).not.toContain(
    'no-hide-descendants',
  );
});

test('an element with no aria-hidden is untouched', () => {
  // The baseline the two above are read against
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<div />)).not.toContain('no-hide-descendants');
});

test('it works on a control-backed element too, not just a box', () => {
  // Each element props class calls the helper from its own constructor;
  // `<button>` has user-agent accessibility defaults of its own, where a
  // conflict would show first
  // $FlowExpectedError[not-a-component] intrinsic tag
  expect(mounted(<button aria-hidden={true} />)).toContain(
    'no-hide-descendants',
  );
});
