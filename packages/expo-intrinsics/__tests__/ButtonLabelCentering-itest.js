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
 * A button's label sits in the middle of the button: a 24-point line box in a
 * 32-point `inline-flex` button with `align-items: center` starts 4 points
 * down, with or without a `display: contents` span around the text (Astryx's
 * Button wraps its label that way), and beside an atomic inline sibling.
 */

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {createRef} from 'react';
import {View} from 'react-native';

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import '@react-native/expo-intrinsics-poc';

function rectOf(ref: {current: HostInstance | null}): {
  y: number,
  height: number,
} {
  const node = ref.current;
  if (node == null) {
    throw new Error('not mounted');
  }
  const rect = node.getBoundingClientRect();
  return {y: rect.y, height: rect.height};
}

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 32,
  paddingTop: 0,
  paddingBottom: 0,
  fontSize: 16,
  lineHeight: 24,
};

describe('a label in a fixed-height flex button', () => {
  it('is centred when it is the only child', () => {
    const button = createRef<HostInstance | null>();
    const label = createRef<HostInstance | null>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400, alignItems: 'flex-start'}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <button ref={button} style={buttonStyle}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={label}>{'Get started'}</span>
          </button>
        </View>,
      );
    });
    const b = rectOf(button);
    const l = rectOf(label);
    expect(l.height).toBe(24);
    expect(l.y - b.y).toBe(4);
  });

  it('is centred when the padding leaves less room than the line', () => {
    // Astryx's Button: 32 high with 8 of padding above and below, so the
    // content box is 16 and the 24-point line overflows it by 4 each way —
    // on the web the label stays centred (align-items: center with negative
    // free space), the overflow being symmetric
    const button = createRef<HostInstance | null>();
    const label = createRef<HostInstance | null>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400, alignItems: 'flex-start'}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <button
            ref={button}
            style={{...buttonStyle, paddingTop: 8, paddingBottom: 8}}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span ref={label}>{'Get started'}</span>
          </button>
        </View>,
      );
    });
    const b = rectOf(button);
    const l = rectOf(label);
    expect(l.height).toBe(24);
    expect(l.y - b.y).toBe(4);
  });

  it('is centred through a display: contents span, beside an atomic inline', () => {
    const button = createRef<HostInstance | null>();
    const label = createRef<HostInstance | null>();
    const icon = createRef<HostInstance | null>();
    const root = Fantom.createRoot();
    Fantom.runTask(() => {
      root.render(
        <View style={{width: 400, alignItems: 'flex-start'}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <button ref={button} style={{...buttonStyle, gap: 8}}>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span style={{display: 'contents'}}>
              {/* $FlowFixMe[prop-missing] intrinsic */}
              <span ref={label}>{'Get started'}</span>
            </span>
            {/* $FlowFixMe[prop-missing] intrinsic */}
            <span
              ref={icon}
              style={{display: 'inline-block', width: 16, height: 16}}
            />
          </button>
        </View>,
      );
    });
    const b = rectOf(button);
    const l = rectOf(label);
    const i = rectOf(icon);
    expect(i.y - b.y).toBe(8);
    expect(l.height).toBe(24);
    expect(l.y - b.y).toBe(4);
  });
});
