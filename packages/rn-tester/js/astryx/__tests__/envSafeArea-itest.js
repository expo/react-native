/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as stylex from '../stylex-rn';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

const NOTCHED = {top: 47, left: 0, right: 0, bottom: 34};

// Renders an element with `style` around a marker, and returns the root and
// the marker
function renderInset(
  style: {[string]: unknown},
  safeAreaInsets: {top: number, left: number, right: number, bottom: number},
): {root: $FlowFixMe, marker: {current: $FlowFixMe}} {
  const marker = React.createRef<$FlowFixMe>();
  const root = Fantom.createRoot({safeAreaInsets});
  Fantom.runTask(() => {
    root.render(
      // An element that reads no `env()` around the one that does, so a
      // change to the insets has to reach below a subtree the pass would
      // otherwise keep whole
      jsx('div', {
        children: jsx('div', {
          ...stylex.props(style),
          children: jsx('div', {ref: marker, style: {height: 10}}),
        }),
      }) as $FlowFixMe,
    );
  });
  return {root, marker};
}

function markerPosition(style: {[string]: unknown}): {x: number, y: number} {
  const {marker} = renderInset(style, NOTCHED);
  const {x, y} = marker.current.getBoundingClientRect();
  return {x, y};
}

describe('env(safe-area-inset-*)', () => {
  it('resolves to the surface’s inset', () => {
    expect(markerPosition({paddingTop: 'env(safe-area-inset-top)'}).y).toBe(47);
  });

  it('resolves inside calc()', () => {
    expect(
      markerPosition({paddingTop: 'calc(env(safe-area-inset-top) + 10px)'}).y,
    ).toBe(57);
  });

  it('resolves inside max()', () => {
    expect(
      markerPosition({paddingTop: 'max(env(safe-area-inset-top), 20px)'}).y,
    ).toBe(47);
  });

  it('resolves to a published zero rather than the fallback', () => {
    expect(
      markerPosition({paddingLeft: 'env(safe-area-inset-left, 24px)'}).x,
    ).toBe(0);
  });

  it('keeps the fallback for a name the surface does not define', () => {
    expect(
      markerPosition({paddingTop: 'env(keyboard-inset-height, 24px)'}).y,
    ).toBe(24);
  });

  it('follows the surface when its insets change', () => {
    const {root, marker} = renderInset(
      {
        paddingTop: 'max(env(safe-area-inset-top), 20px)',
        paddingLeft: 'env(safe-area-inset-left)',
      },
      NOTCHED,
    );
    expect(marker.current.getBoundingClientRect().y).toBe(47);
    expect(marker.current.getBoundingClientRect().x).toBe(0);

    // The device rotated: the notch is now on the left
    Fantom.runTask(() => {
      root.setSafeAreaInsets({top: 0, left: 47, right: 47, bottom: 21});
    });
    expect(marker.current.getBoundingClientRect().y).toBe(20);
    expect(marker.current.getBoundingClientRect().x).toBe(47);
  });
});
