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

/**
 * `getComputedStyle` answers CSSOM's resolved values: strings, lengths in
 * pixels, `0px` for a padding or margin nothing set, and the used size.
 * Astryx's OverflowList subtracts `parseFloat(style.paddingLeft)` from its
 * parent's width; an absent padding made that `NaN`, so every item "fit" and
 * a row of filters ran off the screen instead of collapsing into "+N".
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';
import '../document-shim';
import '../dom-compat';

import {jsx} from '../jsx-runtime';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';

describe('getComputedStyle', () => {
  it('resolves edges, lengths and the used size', () => {
    const element = React.createRef<$FlowFixMe>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        jsx('div', {
          ref: element,
          style: {
            paddingHorizontal: 8,
            paddingTop: 4,
            gap: 4,
            opacity: 0.5,
            width: 300,
            maxWidth: 246,
            height: 36,
          },
        }) as $FlowFixMe,
      );
    });
    const style: $FlowFixMe = global.getComputedStyle(element.current);
    expect(parseFloat(style.paddingLeft)).toBe(8);
    expect([
      style.paddingLeft,
      style.paddingRight,
      style.paddingTop,
      style.paddingBottom,
      style.paddingInlineStart,
      style.paddingBlockEnd,
    ]).toEqual(['8px', '8px', '4px', '0px', '8px', '0px']);
    expect([style.marginLeft, style.borderTopWidth]).toEqual(['0px', '0px']);
    // The engine resolves `gap` into its two longhands
    expect([style.columnGap, style.rowGap, style.opacity]).toEqual([
      '4px',
      '4px',
      '0.5',
    ]);
    // The maximum overrules the stated width
    expect([style.width, style.height]).toEqual(['246px', '36px']);
    expect(style.overflowX).toBe('visible');
    expect(style.getPropertyValue('padding-left')).toBe('8px');
  });

  it('answers the transition longhands and shorthand', () => {
    const plain = React.createRef<$FlowFixMe>();
    const moving = React.createRef<$FlowFixMe>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        jsx('div', {
          children: [
            jsx('div', {key: 'plain', ref: plain}),
            jsx('div', {
              key: 'moving',
              ref: moving,
              style: {
                transitionProperty: 'transform, opacity',
                transitionDuration: '300ms',
                transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
              },
            }),
          ],
        }) as $FlowFixMe,
      );
    });
    // Nothing declared: the initial values (css-transitions-1 §2)
    expect(global.getComputedStyle(plain.current).transition).toBe(
      'all 0s ease 0s',
    );
    const style: $FlowFixMe = global.getComputedStyle(moving.current);
    expect(style.transitionDelay).toBe('0s');
    expect(style.transition).toBe(
      'transform 300ms cubic-bezier(0.2, 0, 0, 1) 0s, ' +
        'opacity 300ms cubic-bezier(0.2, 0, 0, 1) 0s',
    );
  });
});
