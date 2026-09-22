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

import NativeChatBubble, {
  CHAT_BUBBLE_DRAWS_TAIL,
  CHAT_BUBBLE_TAIL_DROP,
} from '../src/NativeChatBubble';
import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';

import '@react-native/expo-intrinsics-poc';

/**
 * What a tail costs and what it must not: height, by which the box grows with
 * the content held inside the body, and no width. The platform's tailed and
 * tailless balloons share their edges to a third of a point and their text
 * starts in the same place; a reserve on the wrong axis is only visible with two
 * balloons side by side.
 */
function box(ref: {current: HostInstance | null}) {
  const rect = nullthrows(ref.current).getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function render(
  tail: ?string,
  bubble: {current: HostInstance | null},
  label: {current: HostInstance | null},
) {
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      // Shrink-wrapped, or the balloon is a block box the full width of its
      // parent and `width` says nothing about it
      <div
        style={{
          width: 300,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}>
        <NativeChatBubble
          ref={bubble}
          tail={tail}
          style={{paddingHorizontal: 14, paddingVertical: 10}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          {/* `margin: 0` because `<p>` has one from the UA sheet — an em above
              and below — and this is measuring the BALLOON's padding, not the
              paragraph's. */}
          <p ref={label} style={{fontSize: 17, lineHeight: 22, margin: 0}}>
            Hi
          </p>
        </NativeChatBubble>
      </div>,
    );
  });
  return root;
}

/**
 * What a tail costs here: its drop where the surface draws one, nothing where
 * it does not. Fantom bundles for Android, which draws no tail, so this reads
 * zero; a reserve with no shape in it is an empty strip under the balloon.
 */
const reserve = CHAT_BUBBLE_DRAWS_TAIL ? CHAT_BUBBLE_TAIL_DROP : 0;

test('a tail costs height and nothing else', () => {
  const tailed = createRef<HostInstance>();
  const tailedLabel = createRef<HostInstance>();
  const plain = createRef<HostInstance>();
  const plainLabel = createRef<HostInstance>();

  render('trailing', tailed, tailedLabel);
  render(null, plain, plainLabel);

  const a = box(tailed);
  const b = box(plain);

  expect(a.width).toBe(b.width);
  expect(a.left).toBe(b.left);
  /*
   * Within a pixel: layout is rounded to the display's grid, so 6.62 points on a
   * 3x screen lands on 20 pixels and arrives as 6.667.
   */
  expect(a.height - b.height).toBeCloseTo(reserve, 1);
});

test('the text is in the same place with a tail and without', () => {
  /*
   * Both in one root and both right-aligned: a sent balloon is pinned to the
   * trailing margin, so a wider box pushes its own text along. Measuring each
   * balloon's text against its own left edge cannot see that.
   */
  const tailed = createRef<HostInstance>();
  const tailedLabel = createRef<HostInstance>();
  const plain = createRef<HostInstance>();
  const plainLabel = createRef<HostInstance>();

  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div
        style={{
          width: 300,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
        }}>
        <NativeChatBubble
          ref={plain}
          style={{paddingHorizontal: 14, paddingVertical: 10}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <p ref={plainLabel} style={{fontSize: 17, lineHeight: 22, margin: 0}}>
            Hi
          </p>
        </NativeChatBubble>
        <NativeChatBubble
          ref={tailed}
          tail="trailing"
          style={{paddingHorizontal: 14, paddingVertical: 10}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          <p
            ref={tailedLabel}
            style={{fontSize: 17, lineHeight: 22, margin: 0}}>
            Hi
          </p>
        </NativeChatBubble>
      </div>,
    );
  });

  const boxA = box(tailed);
  const boxB = box(plain);
  expect(boxA.left).toBe(boxB.left);
  expect(boxA.left + boxA.width).toBe(boxB.left + boxB.width);
  expect(box(tailedLabel).left).toBe(box(plainLabel).left);
});

test('the reserve is added to the padding an author wrote, not instead of it', () => {
  /*
   * `padding` and `paddingVertical` reach the bottom edge too; reading only
   * `paddingBottom` would let the specific edge replace an author's general
   * padding rather than add to it.
   */
  const bubble = createRef<HostInstance>();
  const label = createRef<HostInstance>();
  const root = Fantom.createRoot();
  Fantom.runTask(() => {
    root.render(
      // $FlowFixMe[prop-missing] intrinsic
      <div style={{width: 300}}>
        <NativeChatBubble ref={bubble} tail="trailing" style={{padding: 12}}>
          {/* $FlowFixMe[prop-missing] intrinsic */}
          {/* `margin: 0` because `<p>` has one from the UA sheet — an em above
              and below — and this is measuring the BALLOON's padding, not the
              paragraph's. */}
          <p ref={label} style={{fontSize: 17, lineHeight: 22, margin: 0}}>
            Hi
          </p>
        </NativeChatBubble>
      </div>,
    );
  });

  const outer = box(bubble);
  const inner = box(label);
  expect(inner.top - outer.top).toBe(12);
  expect(outer.top + outer.height - (inner.top + inner.height)).toBeCloseTo(
    12 + reserve,
    1,
  );
});
