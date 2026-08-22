/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @fantom_flags enableStringChildren:true
 * @fantom_flags enableYogaDisplayBlock:true
 * @flow strict-local
 * @format
 */

/**
 * `<select>` shrink-to-fits its widest option — the web's rule (real Safari:
 * 41/72/239px for one-char/short/long option sets) and each platform's own
 * idiom — measured SYNCHRONOUSLY in the layout pass, so the control mounts at
 * its final size with no intermediate frame. Floors at the platform touch
 * width; clamps to the container; an author width overrides the measure.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

function renderSelect(
  options: Array<string>,
  containerWidth: number = 360,
  style?: {[string]: unknown},
): number {
  const root = Fantom.createRoot();
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: containerWidth, alignItems: 'flex-start'}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <select ref={ref} style={style}>
          {options.map(label => (
            // $FlowFixMe[prop-missing] intrinsic
            <option key={label}>{label}</option>
          ))}
        </select>
      </div>,
    );
  });
  return nullthrows(ref.current).getBoundingClientRect().width;
}

test('a longer widest option makes a wider select', () => {
  const short = renderSelect(['Apple', 'Banana', 'Cherry']);
  const long = renderSelect([
    'Apple',
    'A considerably longer option label',
    'Cherry',
  ]);
  expect(long).toBeGreaterThan(short);
  // And the width is content-driven, not a constant: two DIFFERENT contents
  // must not both land on some fixed number.
  expect(short).toBeGreaterThan(48); // above the floor: real content counted
});

test('a tiny option set stays at or above the touch-target width', () => {
  // 'A' measures ~10 + the control chrome (32) = 42 content, wrapped in the
  // field surface's 32 of padding: 74. The 48dp floor is an INVARIANT here,
  // not the binding term — it binds only if the sheet ever loses its
  // padding, which is exactly when a floor must catch it.
  const width = renderSelect(['A']);
  expect(width).toBeGreaterThanOrEqual(48);
  expect(width).toBeLessThan(90); // and still content-driven, not the old fixed 200
});

test('a very long option clamps to the container, never overflowing', () => {
  const width = renderSelect(
    [
      'An option label so long that no closed control could ever show it in one line',
    ],
    200,
  );
  expect(width).toBeLessThanOrEqual(200);
});

test('a plain column does not stretch the control', () => {
  // RN's alignItems default is stretch; the web's inline-level select never
  // fills its container without width:100%. The UA alignSelf keeps the
  // measured width in an UNSTYLED container — the exact shape the forms
  // demo rendered full-width when this was missing.
  const root = Fantom.createRoot();
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 360}}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <select ref={ref}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <option>Banana</option>
        </select>
      </div>,
    );
  });
  const width = nullthrows(ref.current).getBoundingClientRect().width;
  expect(width).toBeLessThan(200);
  expect(width).toBeGreaterThan(48);
});

test('an author width beats the measure entirely', () => {
  expect(renderSelect(['Apple', 'Banana'], 360, {width: 120})).toBe(120);
});
