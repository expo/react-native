/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {CHAT_BUBBLE_TAIL_DROP} from '../../expo-intrinsics/src/chatBubbleMetrics';

/*
 * A tail adds `CHAT_BUBBLE_TAIL_DROP` to the balloon's height and nothing to
 * the part above the tail, as in native Messages.
 * See ui-metrics.md, "Balloon tail reserve".
 */
const BASE_PADDING = 10;

/** Mirrors `paddingBottom` in expo-intrinsics/src/NativeChatBubble.js. */
function paddingBottomFor(tailed: boolean): number {
  return BASE_PADDING + (tailed ? CHAT_BUBBLE_TAIL_DROP : 0);
}

/** Height of the balloon above the tail. */
function bodyHeight(boxHeight: number, tailAmount: number): number {
  return boxHeight - tailAmount * CHAT_BUBBLE_TAIL_DROP;
}

describe('the tail reserve', () => {
  it('costs the box exactly the tail drop and nothing else', () => {
    expect(paddingBottomFor(true) - paddingBottomFor(false)).toBeCloseTo(
      CHAT_BUBBLE_TAIL_DROP,
      5,
    );
  });

  it('leaves the body unchanged when the tail retracts', () => {
    const text = 30;
    const tailedBox = text + BASE_PADDING + paddingBottomFor(true);
    const taillessBox = text + BASE_PADDING + paddingBottomFor(false);

    expect(bodyHeight(tailedBox, 1)).toBeCloseTo(bodyHeight(taillessBox, 0), 5);
  });

  it('holds the body steady across every frame of the morph', () => {
    const text = 30;
    // NativeChatBubble draws the tail from the current padding, so mid-morph
    // the tail amount is the reserve divided by `CHAT_BUBBLE_TAIL_DROP`.
    const bodies = [1, 0.74, 0.51, 0.32, 0.16, 0.04, 0].map(amount => {
      const box =
        text + BASE_PADDING + BASE_PADDING + amount * CHAT_BUBBLE_TAIL_DROP;
      return bodyHeight(box, amount);
    });
    for (const body of bodies) {
      expect(body).toBeCloseTo(bodies[0], 5);
    }
  });
});
