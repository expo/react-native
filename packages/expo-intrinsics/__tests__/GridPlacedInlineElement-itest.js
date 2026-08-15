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
 * An inline element with an explicit grid placement is a grid item, and a
 * grid item is blockified (css-grid-2 §6.1, css-display-3 §2.7). The placement
 * has to reach the grid: two spans placed in the same cell overlap in it, they
 * do not stack in auto-placed rows. Astryx's Tab draws a hidden bold copy of
 * its label under the label this way, so the tab keeps its width when it is
 * selected.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

function rectOf(ref: {current: HostInstance | null}): {
  x: number,
  y: number,
  width: number,
  height: number,
} {
  const node = ref.current;
  if (node == null) {
    throw new Error('not mounted');
  }
  const rect = node.getBoundingClientRect();
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

describe('an inline element placed in a grid', () => {
  it('lands in the cell it names, under the item already there', () => {
    const container = createRef<HostInstance | null>();
    const label = createRef<HostInstance | null>();
    const sizer = createRef<HostInstance | null>();

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400, alignItems: 'flex-start'}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={container} style={{display: 'inline-grid'}}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={label} style={{gridRowStart: 1, gridColumnStart: 1}}>
              {'Lifestyle'}
            </span>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span
              ref={sizer}
              style={{
                gridRowStart: 1,
                gridColumnStart: 1,
                opacity: 0,
                fontWeight: 'bold',
              }}>
              {'Lifestyle'}
            </span>
          </span>
        </View>,
      );
    });

    const labelRect = rectOf(label);
    const sizerRect = rectOf(sizer);
    const containerRect = rectOf(container);
    // Same cell: the same top edge, and one line's height between them
    expect(sizerRect.y).toBe(labelRect.y);
    expect(containerRect.height).toBe(
      Math.max(labelRect.height, sizerRect.height),
    );
    // The cell is as wide as the wider of the two, which is the bold copy
    expect(containerRect.width).toBe(
      Math.max(labelRect.width, sizerRect.width),
    );
  });

  it('stacks in auto-placed rows when nothing places it', () => {
    // The control: the same spans with no placement are two grid items in two
    // implicit rows (css-grid-2 §8.5)
    const container = createRef<HostInstance | null>();
    const first = createRef<HostInstance | null>();
    const second = createRef<HostInstance | null>();

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400, alignItems: 'flex-start'}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <span ref={container} style={{display: 'inline-grid'}}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={first}>{'Lifestyle'}</span>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={second}>{'Lifestyle'}</span>
          </span>
        </View>,
      );
    });

    const firstRect = rectOf(first);
    const secondRect = rectOf(second);
    expect(secondRect.y).toBe(firstRect.y + firstRect.height);
    expect(rectOf(container).height).toBe(firstRect.height + secondRect.height);
  });
});
