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
 * An absolutely positioned inline element is out of flow: `position: absolute`
 * blockifies (css-display-3 §2.7) and removes the box from flow (CSS2 §9.7),
 * so it contributes nothing to the line, whether the element opted into inline
 * layout with `display: 'inline'` or is inline by user-agent default. The
 * visually-hidden pattern (a 1x1 clipped absolute `<span>`) depends on it.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

function widthOf(ref: {current: HostInstance | null}): number {
  const node = ref.current;
  if (node == null) {
    throw new Error('not mounted');
  }
  return node.getBoundingClientRect().width;
}

describe('an absolutely positioned inline element', () => {
  it('does not lengthen the line it was written in', () => {
    const plain = createRef<HostInstance | null>();
    const withHidden = createRef<HostInstance | null>();

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400}}>
          {/* The same visible words, once alone and once beside an
              absolutely-positioned span. Out of flow means the second line is
              no longer than the first. */}
          <View ref={plain} style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
          </View>
          <View
            ref={withHidden}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
              }}>
              {'completed'}
            </span>
          </View>
        </View>,
      );
    });

    expect(widthOf(withHidden)).toBe(widthOf(plain));
  });

  it('keeps the hidden text in the tree, since that is what it is for', () => {
    // Out of flow is not unmounted: the span still exists for assistive
    // technology, which is the only reason a visually-hidden span exists
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400}}>
          <View style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
              }}>
              {'completed'}
            </span>
          </View>
        </View>,
      );
    });

    expect(
      JSON.stringify(root.getRenderedOutput({props: []}).toJSX()) ?? '',
    ).toContain('completed');
  });

  it('still lays out in the line when it is not positioned', () => {
    // The control: without `position: absolute` the same span lengthens the line
    const plain = createRef<HostInstance | null>();
    const withSpan = createRef<HostInstance | null>();

    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400}}>
          <View ref={plain} style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
          </View>
          <View
            ref={withSpan}
            style={{display: 'block', alignSelf: 'flex-start'}}>
            {'Cart'}
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span>{'completed'}</span>
          </View>
        </View>,
      );
    });

    expect(widthOf(withSpan)).toBeGreaterThan(widthOf(plain));
  });
});
