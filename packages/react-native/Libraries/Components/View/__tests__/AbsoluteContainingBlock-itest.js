/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 * @fantom_flags enableYogaDisplayBlock:true
 */

/**
 * An absolutely positioned box is placed against the web's containing block
 * (CSS2 §10.1, css-position-3 §4.1): the padding box of its nearest positioned
 * ancestor, which its percentages are of, with the box at the content edge
 * where it states no inset, as the sole item of a flex container would be
 * (css-flexbox-1 §4.1). Yoga's legacy errata took the content box and the
 * padding edge; `enableYogaDisplayBlock` clears them with its other web
 * behaviours.
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {ViewStyleProp} from '../../../StyleSheet/StyleSheet';
import type {HostInstance} from 'react-native';

import ensureInstance from '../../../../src/private/__tests__/utilities/ensureInstance';
import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';
import ReactNativeElement from 'react-native/src/private/webapis/dom/nodes/ReactNativeElement';

function boxOf(ref: {current: HostInstance | null}): string {
  const box = ensureInstance(
    ref.current,
    ReactNativeElement,
  ).getBoundingClientRect();
  return `${box.x},${box.y} ${box.width}x${box.height}`;
}

// An 87-point tab with 12 points of padding on each side, as Astryx draws one,
// holding the absolutely positioned child `childStyle` describes
function renderInPaddedBox(childStyle: ViewStyleProp): {
  current: HostInstance | null,
} {
  const child = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      <View style={{flexDirection: 'row', alignItems: 'flex-start'}}>
        <View
          style={{
            position: 'relative',
            paddingHorizontal: 12,
            paddingVertical: 4,
            width: 87,
            height: 32,
          }}>
          <View ref={child} style={childStyle} />
        </View>
      </View>,
    );
  });
  return child;
}

describe('an absolutely positioned box', () => {
  it('takes its percentages of the padding box', () => {
    const child = renderInPaddedBox({
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: '50%',
    });
    expect(boxOf(child)).toBe('0,0 87x16');
  });

  it("fills the padding box with inset 0 and a width of 100%, as a tab's hover pill", () => {
    const child = renderInPaddedBox({
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      margin: 'auto',
      width: '100%',
      height: 32,
    });
    expect(boxOf(child)).toBe('0,0 87x32');
  });

  it('sits at the content edge where it states no inset', () => {
    const child = renderInPaddedBox({
      position: 'absolute',
      width: 10,
      height: 10,
    });
    expect(boxOf(child)).toBe('12,4 10x10');
  });
});
