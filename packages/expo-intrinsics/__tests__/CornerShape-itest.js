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
 * `corner-shape` (css-borders-4 §5.1) reaches the renderer. Fantom has no
 * pixels, so the curve is a device screenshot's job; what it pins is the value's
 * journey: the style attribute, the view config, `fromRawValue` and the
 * shorthand's cascade, each of which drops the property silently and renders
 * `round`. The shape is read back through `getDebugProps`, which prints the
 * four resolved corners as the spec's `k`, clockwise from top-left.
 */

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

// Named rather than `{...}` or an indexer, neither of which Flow will spread
// into the object literal below
type CornerStyle = Readonly<{
  cornerShape?: string,
  cornerTopLeftShape?: string,
  cornerTopRightShape?: string,
  cornerBottomRightShape?: string,
  cornerBottomLeftShape?: string,
}>;

function cornersOf(style: CornerStyle): string {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    // $FlowExpectedError[not-a-component] intrinsic tag
    root.render(
      <div
        style={{
          width: 40,
          height: 40,
          // Both needed: `corner-shape` shapes the corner `border-radius`
          // makes, and the background keeps the box from being flattened away
          borderRadius: 16,
          backgroundColor: 'blue',
          ...style,
        }}
      />,
    );
  });
  const jsx = JSON.stringify(
    root.getRenderedOutput({props: ['cornerShape']}).toJSX(),
  );
  const match = /"cornerShape":"([^"]*)"/.exec(jsx ?? '');
  // The prop is absent whenever the value equals the default
  return match == null ? '' : match[1];
}

test('every keyword is its own superellipse', () => {
  // The spec defines each keyword as a `superellipse()`; these are its parameters
  expect(cornersOf({cornerShape: 'squircle'})).toBe('2 2 2 2');
  expect(cornersOf({cornerShape: 'bevel'})).toBe('0 0 0 0');
  expect(cornersOf({cornerShape: 'scoop'})).toBe('-1 -1 -1 -1');
  expect(cornersOf({cornerShape: 'square'})).toBe(
    'square square square square',
  );
  expect(cornersOf({cornerShape: 'notch'})).toBe('notch notch notch notch');
});

test('round is the initial value, so it prints nothing', () => {
  expect(cornersOf({})).toBe('');
  // The same answer a dropped property gives, which the other assertions
  // rely on being distinguishable
  expect(cornersOf({cornerShape: 'round'})).toBe('');
});

test('superellipse() takes the same parameter as the keywords', () => {
  expect(cornersOf({cornerShape: 'superellipse(2)'})).toBe(
    cornersOf({cornerShape: 'squircle'}),
  );
  expect(cornersOf({cornerShape: 'superellipse(0)'})).toBe(
    cornersOf({cornerShape: 'bevel'}),
  );
  expect(cornersOf({cornerShape: 'superellipse(-1)'})).toBe(
    cornersOf({cornerShape: 'scoop'}),
  );
  // A shape with no keyword of its own
  expect(cornersOf({cornerShape: 'superellipse(3)'})).toBe('3 3 3 3');
  expect(cornersOf({cornerShape: 'superellipse(0.5)'})).toBe('0.5 0.5 0.5 0.5');
});

test('a longhand overrides the shorthand on its own corner', () => {
  // Clockwise from top-left
  expect(
    cornersOf({cornerShape: 'bevel', cornerTopLeftShape: 'squircle'}),
  ).toBe('2 0 0 0');
  expect(
    cornersOf({cornerShape: 'bevel', cornerTopRightShape: 'squircle'}),
  ).toBe('0 2 0 0');
  expect(
    cornersOf({cornerShape: 'bevel', cornerBottomRightShape: 'squircle'}),
  ).toBe('0 0 2 0');
  expect(
    cornersOf({cornerShape: 'bevel', cornerBottomLeftShape: 'squircle'}),
  ).toBe('0 0 0 2');
});

test('a longhand alone leaves the other three at the initial value', () => {
  expect(cornersOf({cornerTopLeftShape: 'scoop'})).toBe('-1 1 1 1');
});

test('an unreadable value falls back to round rather than to nothing', () => {
  // A typo renders the initial value, not an empty box
  expect(cornersOf({cornerShape: 'squirckle'})).toBe('');
  expect(cornersOf({cornerShape: 'superellipse()'})).toBe('');
});
