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

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/*
 * A <button> centres its content on both axes: `align-content` for the block
 * axis (css-align-3 §5.3) and `text-align` for the inline one. The numbers are
 * Safari's on the same markup at a 402pt viewport.
 */
function offsetInParent(
  child: {current: HostInstance | null},
  parent: {current: HostInstance | null},
): {left: number, top: number} {
  const c = nullthrows(child.current).getBoundingClientRect();
  const p = nullthrows(parent.current).getBoundingClientRect();
  return {left: c.left - p.left, top: c.top - p.top};
}

test('a block-container button centres its content', () => {
  const root = Fantom.createRoot();
  const button = createRef<HostInstance>();
  const indicator = createRef<HostInstance>();

  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div
        style={{
          width: 300,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
        }}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <button ref={button} style={{width: 16, height: 16, borderWidth: 1}}>
          {/* The radio's indicator: an unsized box, so it fills the content
              width as any block box does and centres the dot on the inline
              axis itself. The block axis is the button's to give. */}
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <div ref={indicator} style={{width: 10, height: 10}} />
          </div>
        </button>
      </div>,
    );
  });

  expect(offsetInParent(indicator, button)).toEqual({left: 3, top: 3});
});

test('an author flex button keeps its own alignment', () => {
  const root = Fantom.createRoot();
  const track = createRef<HostInstance>();
  const thumb = createRef<HostInstance>();

  // A switch thumb sits at one end of its track, so the centring must not
  // reach a button the author made a flex container
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <button
        ref={track}
        style={{
          display: 'inline-flex',
          width: 44,
          height: 24,
          borderWidth: 2,
          alignItems: 'center',
        }}>
        {/* $FlowFixMe[prop-missing] intrinsic */}
        <div ref={thumb} style={{width: 20, height: 20}} />
      </button>,
    );
  });

  const offset = offsetInParent(thumb, track);
  expect(offset.left).toBe(2);
  expect(offset.top).toBe(2);
});
