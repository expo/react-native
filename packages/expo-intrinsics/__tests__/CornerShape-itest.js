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
 * `corner-shape` (css-borders-4 §5.1) reaches the platform.
 *
 * ## What this can see, and what it cannot
 *
 * Fantom has no pixels, so it cannot check the CURVE — that is a device
 * screenshot, and the seven-value row in `packages/chat-demo` is what was
 * used. What it can see is the value's whole journey to the renderer: the style
 * attribute, the view config, `fromRawValue`, and the shorthand's cascade.
 *
 * That journey is worth pinning on its own, because every way it breaks looks
 * the same from JS. A property missing from `ReactNativeStyleAttributes` is
 * dropped silently; so is one missing from the view config, or from the
 * flattening list. In all three cases the box renders as `round` — the initial
 * value — and nothing anywhere says a word.
 *
 * The shape is read back through `getDebugProps`, which prints the four
 * RESOLVED corners as the spec's `k`, clockwise from top-left.
 */

import * as Fantom from '@react-native/fantom';
import * as React from 'react';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

/**
 * The corner properties, named.
 *
 * Not `{...}` and not an indexer: Flow will spread neither into an object
 * literal — the first because it cannot rule out a conflicting `width`, the
 * second because a string index may overwrite the explicit keys beside it. The
 * five names are the whole property, so writing them costs nothing and says
 * what the helper takes.
 */
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
          // Both load-bearing. `border-radius` is the corner `corner-shape`
          // shapes — without one there is no corner and the property is a
          // no-op — and a background is what stops the box being flattened
          // away before it reaches the mounting layer. Neither radius nor
          // shape prevents flattening on its own, which is correct: a box
          // that paints nothing has no corner to see.
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
  // The empty string, not a throw: the prop is absent whenever the value equals
  // the default, which is itself something the tests below assert.
  return match == null ? '' : match[1];
}

test('every keyword is its own superellipse', () => {
  // The spec defines each keyword AS a `superellipse()`, so these are the
  // parameters it gives, not a scale of our own. A wrong one does not fail to
  // draw — it draws a different shape that looks entirely deliberate.
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
  // Written as well as the default, because this is the answer a DROPPED
  // property gives too. Every other assertion in the file is only meaningful
  // because this one distinguishes them.
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
  // And the point of the function: a shape with no keyword of its own.
  expect(cornersOf({cornerShape: 'superellipse(3)'})).toBe('3 3 3 3');
  expect(cornersOf({cornerShape: 'superellipse(0.5)'})).toBe('0.5 0.5 0.5 0.5');
});

test('a longhand overrides the shorthand on its own corner', () => {
  // Clockwise from top-left, which is the order the string is printed in.
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
  // A typo should render the initial value, not a shape nobody asked for and
  // not an empty box.
  expect(cornersOf({cornerShape: 'squirckle'})).toBe('');
  expect(cornersOf({cornerShape: 'superellipse()'})).toBe('');
});
