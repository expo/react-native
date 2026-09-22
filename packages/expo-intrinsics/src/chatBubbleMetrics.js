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
 *
 * ## 335, refitted from a device (2026-09-16)
 *
 * The reading above is superseded, and by a better measurement of the same
 * event rather than by an opinion. A clip of the platform's chat from a real
 * phone, 60fps, tracking ONE balloon's top edge through a receipt handover —
 * twenty-two frames over 58 pixels of travel, where the reading above had
 * fourteen frames over 24 and was quoting per-frame deltas of `+1` and `+2` at
 * its own quantisation floor.
 *
 * Fitted over duration and the whole cubic-bezier family:
 *
 *     free cubic-bezier(0.2, 0.05, 0.15, 1) at 335ms   rms 0.14pt
 *     CSS `ease` at 295ms                              rms 0.34pt
 *     CSS `ease-in-out` at its own best duration       rms 1.38pt
 *
 * `ease-in-out` cannot be made to fit at ANY duration — eleven times the
 * residual, and far outside what a one-pixel quantisation can explain.
 */
export const CHAT_BUBBLE_TAIL_MORPH: number = 335;

/**
 * And the curve it moves on, which is a SPRING wearing a bezier.
 *
 * The same twenty-two frames fitted against a damped-spring solution instead:
 *
 *     omega 19.5 rad/s, zeta 0.98   rms 0.12pt   (mass 1, k 380.2, c 38.22)
 *
 * Critically damped, to two decimal places, and 99% settled at 241ms. That is
 * what produces the shape: it accelerates hard from rest, and then creeps in
 * asymptotically for as long again. Half its travel is done at 87ms where
 * `ease-in-out` is only half done at 125.
 *
 * So the note above this one had it backwards — the deltas ARE front-loaded and
 * they DO taper for twice as long as they built, which is exactly the spring it
 * said was ruled out. What ruled it out was a journey too short to tell the two
 * apart: at 24 pixels the difference between symmetric and front-loaded is one
 * pixel a frame.
 *
 * Stated as a bezier because that is what the renderer's transitions take, and
 * the free bezier fit is as good as the spring itself (0.14pt against 0.12), so
 * nothing is lost in the translation.
 *
 * The earlier report of the movement being "jarring" still stands and is not an
 * argument against this: `ease-out` starts at FULL SPEED from rest, which is a
 * discontinuity. This starts at rest — `p1y` is 0.05, not 0 — and only then
 * accelerates.
 */
export const CHAT_BUBBLE_TAIL_MORPH_CURVE: string =
  'cubic-bezier(0.2, 0.05, 0.15, 1)';

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
