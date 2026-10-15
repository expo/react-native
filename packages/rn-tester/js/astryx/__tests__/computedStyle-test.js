/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * @format
 */

'use strict';

import '../dom-compat';

import {jsx} from '../jsx-runtime';
import TestRenderer from 'react-test-renderer';

/**
 * `getComputedStyle` answers CSSOM's resolved values: strings, lengths in
 * pixels, `0px` for a padding or margin nothing set, and the used size.
 * Astryx's OverflowList subtracts `parseFloat(style.paddingLeft)` from its
 * parent's width; an absent padding made that `NaN`, so every item "fit" and
 * a row of filters ran off the screen instead of collapsing into "+N".
 */
describe('getComputedStyle', () => {
  it('resolves edges, lengths and the used size', () => {
    const node = {
      getBoundingClientRect: () => ({x: 0, y: 0, width: 246, height: 36}),
    };
    let renderer;
    TestRenderer.act(() => {
      renderer = TestRenderer.create(
        jsx('div', {
          style: {
            paddingHorizontal: 8,
            paddingTop: 4,
            gap: 4,
            opacity: 0.5,
            width: 300,
            maxWidth: 246,
          },
        }) as $FlowFixMe,
        {createNodeMock: () => node},
      );
    });
    const style: $FlowFixMe = global.getComputedStyle(node);
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
    expect([style.gap, style.opacity]).toEqual(['4px', '0.5']);
    expect([style.width, style.height]).toEqual(['246px', '36px']);
    expect(style.overflowX).toBe('visible');
    expect(style.getPropertyValue('padding-left')).toBe('8px');
    TestRenderer.act(() => {
      renderer.unmount();
    });
  });
});
