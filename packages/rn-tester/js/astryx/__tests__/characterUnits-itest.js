/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableStringChildren:true enableYogaDisplayBlock:true
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

// The style pass has no font metrics, so CSS Values §6.1.1's 0.5em
// fallback applies. These check length resolution, not the font's glyphs.
describe('character-relative lengths', () => {
  for (const [width, expected] of [
    ['3ch', 30],
    ['calc(2ch + 4px)', 24],
    ['3rch', 24],
  ]) {
    it(`resolves ${width} against the correct font size`, () => {
      const root = Fantom.createRoot();
      const box = React.createRef<$FlowFixMe>();
      Fantom.runTask(() => {
        root.render(
          jsx('div', {
            ref: box,
            style: {fontSize: 20, width, height: 10},
          }) as $FlowFixMe,
        );
      });
      expect(box.current.getBoundingClientRect().width).toBe(expected);
    });
  }

  it('recomputes a stable descendant when its inherited font size changes', () => {
    const root = Fantom.createRoot();
    const box = React.createRef<$FlowFixMe>();
    const child = jsx('div', {
      ref: box,
      style: {width: '2ch', height: 10},
    });
    for (const fontSize of [16, 32]) {
      Fantom.runTask(() => {
        root.render(
          jsx('div', {style: {fontSize}, children: child}) as $FlowFixMe,
        );
      });
      expect(box.current.getBoundingClientRect().width).toBe(fontSize);
    }
  });
});
