/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 * @format
 */

'use strict';

/**
 * The rubber band the transcript is dragged against to show its timestamps.
 *
 * Its own module because it is arithmetic, and arithmetic in a screen cannot be
 * tested without loading the screen — which loads the whole element catalog and
 * fails outside a renderer. One import of `ChatScreen` from a jest file was
 * enough to establish that.
 *
 * Measured off the native chat on a 402-point window, driving a three-second drag
 * the
 * whole width of the screen and tracking a sent balloon's trailing edge frame by
 * frame: it rests at 371, ends at 315, and STOPS there — 56 points, reached
 * before the finger had finished travelling and held for the rest of the drag.
 *
 * Fitted to that one reading, which is the one worth fitting: a 360-point finger
 * moving the balloons 56 puts the limit at 66. Three earlier readings (a
 * 20-point drag moving them 16, a 40-point drag 20, a 161-point drag 39) came
 * off mid-gesture screenshots with a finger that had not finished, disagreed
 * with each other about the limit — 80, 40 and 51 — and are kept here only as
 * the reason not to trust them.
 *
 * The native chat CAPS where this ASYMPTOTES, and the difference is deliberate: a
 * drag
 * that has hit a wall feels broken, and the curve below always has a little more
 * to give. 66 is far enough above `REVEAL_SETTLED` that a decisive drag reaches
 * the settled state and near enough that a very long one lands where the native
 * chat does — 55.8 against 56 for the drag measured above.
 */

export const REVEAL_LIMIT = 66;

/**
 * How wide the revealed column of times is.
 *
 * Wide enough for the LONGEST time it can hold: "10:38 PM" is about fifty
 * points at eleven — and the times are RIGHT-ALIGNED inside it, to the
 * transcript's own margin, because that is how the native chat parks them: every
 * time shares one trailing edge, sixteen points in from the screen, however
 * wide the time is. They were laid out from the column's LEADING edge, which
 * put a narrow time in the right place and ran a two-digit hour out to the
 * screen's edge — reported twice, each time with a screenshot of the native chat
 * whose
 * widest time still kept its sixteen points.
 *
 * Fifty-four with the landing makes the occupied width 56, which is the
 * travel measured off the native chat's own full drag.
 */
export const REVEAL_COLUMN = 54;

/**
 * How far inside the trailing edge the column of times comes to rest.
 *
 * Small, because the times are laid out from the column's LEADING edge: a time
 * of the usual width finishes well inside its own box, so the ink lands on the
 * transcript's margin without the box having to.
 */
export const REVEAL_COLUMN_LANDING = 2;

/**
 * Where a decisive drag lands, and therefore where the column has to arrive.
 *
 * The column's whole occupied width — itself plus its landing inset — and that
 * is the rule rather than a fitted number. A sent balloon rests its own margin
 * from the trailing edge; moving it by exactly what the column takes up leaves
 * that same margin between the balloon and the time, which is what the space
 * between them is FOR.
 *
 * Held to it by `resistedReveal-test`, and confirmed against the native chat: 56
 * here,
 * the same 56 measured off its own full drag.
 *
 * It was 40, and the four points that left between a balloon and its time were
 * reported from a device as "the spacing between the bubbles and the timestamps
 * isn't right", with a screenshot of each app to compare. Both apps put the time
 * in the same place; ours simply did not move the balloons far enough to leave
 * room beside it.
 *
 * The other half of that fix is in the RATE the column travels at, which this
 * number sets — see `REVEAL_COLUMN_RATE` in the screen. At 40 the column had to
 * cross its own width in the balloons' 40, so it moved 1.4x as fast and the gap
 * CLOSED as the drag went on: eighteen points at rest, two by the end, which is
 * why the complaint came with a long drag. At 54 the rate is 1.04 and the gap is
 * the same sixteen wherever the drag stops.
 */
export const REVEAL_SETTLED = REVEAL_COLUMN + REVEAL_COLUMN_LANDING;

/**
 * How far the transcript moves for a finger that has travelled `pulled` points.
 *
 * Two properties define it, and both are what make a resisted drag feel like
 * the platform's:
 *
 *  - it NEVER reaches the limit, so pulling further always does a little more
 *    and the drag never feels like it has hit a wall;
 *  - at exactly the limit's worth of finger it has moved HALF the limit, which
 *    is what sets how quickly the resistance is felt.
 */
export function resistedReveal(pulled) {
  if (!(pulled > 0)) {
    return 0;
  }
  return REVEAL_LIMIT * (1 - 1 / (1 + pulled / REVEAL_LIMIT));
}

/**
 * The gap a sent balloon keeps from its own time once both have landed.
 *
 * Not a number of its own: it falls out of `REVEAL_SETTLED` being the column's
 * occupied width, and it is the transcript's margin because that is what the
 * balloon was keeping from the trailing edge before the drag. A function so the
 * rule can be checked — see `__tests__/resistedReveal-test.js`.
 *
 * This was once solved the other way round, and wrongly: the landing inset was
 * derived from a fixed 40-point travel, which left whatever room that happened
 * to make — twelve points of COLLISION when the column landed on the
 * transcript's margin, and four points of clearance when it was pulled in to
 * two. Both were reported from a device. The travel is the free variable and the
 * gap is the constant, not the other way about.
 */
export function revealGap(transcriptMargin, window = 402) {
  const balloonRight = window - transcriptMargin - REVEAL_SETTLED;
  const columnLeft = window - REVEAL_COLUMN_LANDING - REVEAL_COLUMN;
  return columnLeft - balloonRight;
}

/**
 * How the times FADE IN as the column arrives.
 *
 * They do not simply ride in at full strength: the ink comes up from nothing
 * over the drag, and the drag is what drives it. Measured off a 60 fps capture
 * of the native chat, a sent balloon's trailing edge tracked frame by frame
 * against the ink in the column beside it:
 *
 *     travelled   26.00   35.33   42.33   48.67   53.33   58.00
 *     alpha        0.20    0.34    0.50    0.67    0.81    0.99
 *
 * Two properties of that reading decide the shape here, and both are why this
 * is not a transition:
 *
 *  - it is driven by POSITION, not by a clock. The capture has two stretches
 *    where the finger stopped — frames 48-60 and 106-110 — and the ink is
 *    frozen in both, to the hundredth. A timed fade would have carried on.
 *  - it reaches full strength exactly at the settled state, so the ink lands
 *    with the column rather than before or after it.
 *
 * Fitted against the fraction of the settled travel: `p^2.2` to 0.018 rms, and
 * the alternatives are all worse — `p^2` 0.029, `cubic-bezier(.5,0,1,1)` 0.048,
 * `ease-in` 0.077, `linear` 0.208, `ease` 0.425. So: a power curve of the drag,
 * and the exponent is measured rather than chosen.
 */
export const REVEAL_INK_CURVE = 2.2;

/**
 * The ink's strength for a transcript that has moved `shown` points.
 *
 * A fraction of `REVEAL_SETTLED` rather than of the number measured above, so
 * the ink stays tied to where the column actually lands here. Past the settled
 * state the drag keeps giving (see `resistedReveal`) and the ink does not — it
 * is already all the way up.
 */
export function revealInk(shown) {
  if (!(shown > 0)) {
    return 0;
  }
  if (shown >= REVEAL_SETTLED) {
    return 1;
  }
  return Math.pow(shown / REVEAL_SETTLED, REVEAL_INK_CURVE);
}

/**
 * The same curve as an interpolation the NATIVE driver can run.
 *
 * A native `interpolate` is piecewise linear — it takes stops, not an easing —
 * so the curve is sampled here rather than evaluated per frame. Eight segments
 * hold it to about 0.005 at the worst point, which is a quarter of the rms of
 * the fit the curve came from, so the sampling is not what anyone would see.
 *
 * Built ONCE and shared by every row: one interpolation feeding many views, not
 * one per view. See the screen.
 */
export const REVEAL_INK_STOPS = 8;

export function revealInkRamp() {
  const inputRange = [];
  const outputRange = [];
  for (let stop = 0; stop <= REVEAL_INK_STOPS; stop++) {
    const shown = (REVEAL_SETTLED * stop) / REVEAL_INK_STOPS;
    inputRange.push(shown);
    outputRange.push(revealInk(shown));
  }
  return {inputRange, outputRange, extrapolate: 'clamp'};
}
