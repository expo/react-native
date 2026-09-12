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
 * A balloon's tail, as numbers — with no imports, so anything can read them.
 *
 * They are needed in three places that are not near each other: the component
 * that reserves space for a tail, the app that has to move its own boxes at the
 * same speed, and the tests that check the two agree. A leaf module is what lets
 * a plain unit test import them without pulling a renderer in behind them.
 */

/**
 * How far below the BODY a tail hangs, in points.
 *
 * Kept in step with `kExpoChatBubbleTailDrop` on the native side, which is where
 * the shape is drawn; asserted equal by a test, because the box is laid out from
 * this one and the outline from that one.
 */
export const CHAT_BUBBLE_TAIL_DROP: number = 6.65;

/**
 * How long a tail takes to arrive or leave, in milliseconds.
 *
 * This is really "how long a transcript takes to move", because a tail arriving
 * or leaving IS a layout change — the reserve it hangs in is `padding-bottom`,
 * so the column above it shifts by 6.65 points either way. Anything else that
 * moves that column at the same moment has to move on this clock or the column
 * moves twice.
 *
 * Measured off a recording of the native chat, by cross-correlating the
 * row-average profile of the transcript between consecutive frames — which
 * reads the shift of the whole column rather than of any one balloon I might
 * have picked wrong.
 * A receipt appearing moves it 24 rows over fourteen frames, and the per-frame
 * deltas are
 *
 *     +1 +1 +2 +2 +2 +2 +2 +2 +2 +2 +2 +2 +1 +1
 *
 * Fourteen frames at 59.94fps is 234ms, with the first and last frames partial
 * because the animation did not begin on a frame boundary: 250ms, which is
 * UIKit's default and not a coincidence.
 *
 * Two earlier readings of this were wrong in the same way — both counted a
 * tail's frames by eye and got fifty, then a hundred. Eyes are bad at this; a
 * shape that has lost most of its depth stops being legible well before it
 * stops moving, so counting "until I cannot see it" measures legibility, not
 * duration. Correlating the pixels does not have that problem.
 */
export const CHAT_BUBBLE_TAIL_MORPH: number = 250;

/**
 * And the curve it moves on.
 *
 * SYMMETRIC, from the deltas above: the ramp in and the ramp out are the same
 * shape. That rules out a spring, which is what a transcript animation is
 * usually assumed to be — a spring's deltas are front-loaded and then taper for
 * twice as long as they built. Reported from a device as the movement being
 * "jarring", which it was: ease-out starts at full speed, so the column snapped
 * away from rest and then eased into it, and only half the movement was soft.
 */
export const CHAT_BUBBLE_TAIL_MORPH_CURVE: string = 'ease-in-out';

/**
 * How long the tail — reserve and drawn shape together — takes to collapse,
 * and the native chat's own number: frame by frame across a real handover, the
 * tail is still whole while the rows around it slide, then leaves in about three
 * frames at 30fps, shrinking into its corner. The element delays the
 * collapse by `CHAT_BUBBLE_TAIL_MORPH - CHAT_BUBBLE_TAIL_INK_MS` so it lands
 * with the slide. One clock for both quantities: the surface is pinned
 * inside the box, so a drawn amount that outlives the reserve paints below
 * the bubble's edge.
 */
export const CHAT_BUBBLE_TAIL_INK_MS: number = 100;
