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

/*
 * What a tail costs, and what it must not cost.
 *
 * A tail hangs below the body, so it costs HEIGHT — and the box has to grow by
 * exactly that much, with the content held inside the body. It costs no width
 * at all. Measured on a real conversation, Apple's tailed and tailless balloons
 * have the same left and right edges to a third of a point and their text
 * starts in exactly the same place.
 *
 * This is a test rather than a comment because the version it replaced got the
 * AXIS wrong — the app reserved `paddingRight` for the tail — and the result
 * looks like a balloon. It is only visible with two balloons side by side, one
 * ending a run and one not, which is what every real conversation has and no
 * screenshot of a single message does.
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
      // parent and `width` says nothing about the balloon at all — which is how
      // a first draft of this asserted 300 == 300 with the bug in place.
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
 * What a tail costs HERE: its drop where the surface draws one, nothing where it
 * does not. Fantom bundles for Android, which draws no tail, so this reads zero
 * — and that is the property under test, since a reserve with no shape in it is
 * the empty strip that put a balloon's receipt and avatar below its own bottom.
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
   * Within a pixel, because layout is rounded to the display's grid: 6.62
   * points on a 3x screen is 19.86 pixels and lands on 20, so the reserve
   * arrives as 6.667. Asserting the exact number would be asserting the rounding
   * rather than the reserve.
   */
  expect(a.height - b.height).toBeCloseTo(reserve, 1);
});

test('the text is in the same place with a tail and without', () => {
  /*
   * Both in ONE root and both right-aligned, which is the arrangement that
   * showed the bug: a sent balloon is pinned to the trailing margin, so a box
   * that is wider pushes its own text along, and the same word lands in a
   * different place depending on whether its message happened to end a run.
   *
   * Measuring each balloon's text against its OWN left edge cannot see that —
   * the padding is the same either way — which is how a first draft of this test
   * passed with the bug reinstated.
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
   * `padding` and `paddingVertical` reach the bottom edge too, and reading only
   * `paddingBottom` misses an author who wrote a general one — after which
   * setting the specific edge REPLACES their padding rather than adding to it,
   * and the balloon's last line sits against its own bottom. That is not a
   * hypothetical: a UA rule beat an author's `padding: 0` this way once.
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
