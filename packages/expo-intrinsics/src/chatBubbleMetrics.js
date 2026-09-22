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
 * A balloon's tail as numbers, with no imports, so the component that reserves
 * space, the app that moves its own boxes at the same speed and the tests that
 * check the two agree can all read them without a renderer behind them.
 */

/**
 * How far below the body a tail hangs, in points. Kept in step with
 * `kExpoChatBubbleTailDrop` on the native side and asserted equal by a test,
 * since the box is laid out from this one and the outline drawn from that one.
 */
export const CHAT_BUBBLE_TAIL_DROP: number = 6.65;

/**
 * How long a tail takes to arrive or leave, in milliseconds: how long a
 * transcript takes to move, since the reserve is `padding-bottom` and the column
 * above shifts by the drop, so anything else moving that column at the same
 * moment has to move on this clock. Fitted to the platform's chat from a device
 * recording at 60fps, tracking one balloon's top edge through a receipt
 * handover, twenty-two frames over 58 pixels, over duration and the whole
 * cubic-bezier family:
 *     free cubic-bezier(0.2, 0.05, 0.15, 1) at 335ms   rms 0.14pt
 *     CSS `ease` at 295ms                              rms 0.34pt
 *     CSS `ease-in-out` at its own best duration       rms 1.38pt
 * `ease-in-out` cannot be made to fit at any duration.
 */
export const CHAT_BUBBLE_TAIL_MORPH: number = 335;

/**
 * The curve it moves on is a spring wearing a bezier: the same frames fitted
 * against a damped spring give
 *     omega 19.5 rad/s, zeta 0.98   rms 0.12pt   (mass 1, k 380.2, c 38.22)
 * critically damped and 99% settled at 241ms; it accelerates hard from rest and
 * creeps in for as long again, half its travel done at 87ms where `ease-in-out`
 * is half done at 125. Stated as a bezier because that is what the renderer's
 * transitions take, and the free bezier fits as well as the spring. It starts
 * at rest (`p1y` is 0.05, not 0), unlike `ease-out`, which starts at full speed.
 */
export const CHAT_BUBBLE_TAIL_MORPH_CURVE: string =
  'cubic-bezier(0.2, 0.05, 0.15, 1)';

/**
 * How long the tail, reserve and drawn shape together, takes to collapse: in
 * the platform's chat the tail stays whole while the rows around it slide, then
 * leaves in about three frames at 30fps, shrinking into its corner. The element
 * delays the collapse by `CHAT_BUBBLE_TAIL_MORPH - CHAT_BUBBLE_TAIL_INK_MS` so
 * it lands with the slide; one clock for both, since a drawn amount that
 * outlives the reserve paints below the bubble's edge.
 */
export const CHAT_BUBBLE_TAIL_INK_MS: number = 100;
