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
 * The tail costs HEIGHT and nothing else, and the BODY does not move.
 *
 * A tailed balloon reserves `CHAT_BUBBLE_TAIL_DROP` of padding under its text
 * for the tail to hang in; a tailless one does not. So the box is exactly that
 * much taller with a tail, and the body — the drawn balloon above the tail — is
 * the SAME height either way.
 *
 * This is pinned because it was disbelieved. "The bubble grows when it hides its
 * tail" was reported twice from a device, and settling it took the balloon's own
 * numbers, traced natively through a morph:
 *
 *     h=47.0 tail=1.00 body=40.3
 *     h=45.3 tail=0.74 body=40.3
 *     h=41.4 tail=0.16 body=40.3
 *     h=40.3 tail=0.00 body=40.3
 *
 * The box shrank by 6.7 — the reserve — and the body never moved. Apple's own
 * balloon measures the same way (140 -> 119 at 3x, a 7-point reserve), so the
 * relationship below is not merely ours. A change that makes the body vary with
 * the tail is a regression of exactly the thing that was reported and disproved.
 */
const BASE_PADDING = 10;

/** What `NativeChatBubble` puts on the box, expressed as the one rule it follows. */
function paddingBottomFor(tailed: boolean): number {
  return BASE_PADDING + (tailed ? CHAT_BUBBLE_TAIL_DROP : 0);
}

/** The drawn balloon above the tail, which is what a reader sees as its size. */
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
    // A one-line balloon: text box plus its padding, plus the reserve while tailed.
    const text = 30;
    const tailedBox = text + BASE_PADDING + paddingBottomFor(true);
    const taillessBox = text + BASE_PADDING + paddingBottomFor(false);

    expect(bodyHeight(tailedBox, 1)).toBeCloseTo(bodyHeight(taillessBox, 0), 5);
  });

  it('holds the body steady across every frame of the morph', () => {
    const text = 30;
    // The morph interpolates the reserve, so the box and the amount move
    // together — which is the one-clock rule the surface and the box share.
    const bodies = [1, 0.74, 0.51, 0.32, 0.16, 0.04, 0].map(amount => {
      const box = text + BASE_PADDING + BASE_PADDING + amount * CHAT_BUBBLE_TAIL_DROP;
      return bodyHeight(box, amount);
    });
    for (const body of bodies) {
      expect(body).toBeCloseTo(bodies[0], 5);
    }
  });
});
