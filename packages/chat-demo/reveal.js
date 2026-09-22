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
 * Math for the timestamp reveal (dragging the transcript left). Separate from
 * `ChatScreen.js` so `__tests__/resistedReveal-test.js` can run without a
 * renderer.
 */

/*
 * `resistedReveal` approaches this offset (points) but never reaches it, so a
 * longer drag always moves a little further; native Messages stops instead.
 * Fitted so a full-width drag matches native Messages. Must stay above
 * `REVEAL_SETTLED`. See ui-metrics.md, "Timestamp reveal travel".
 */
// Native Messages' side margin. See ui-metrics.md, "Transcript side margin".
export const TRANSCRIPT_MARGIN = 16;
export const REVEAL_LIMIT = 66;

/*
 * Width in points of the timestamp column's content. Fits "10:38 PM" at 11 pt,
 * the font size in `styles.revealTime` in ChatScreen.js; keep them in step.
 * See ui-metrics.md, "Timestamp reveal column".
 */
export const REVEAL_COLUMN = 54;

/*
 * Distance in points from the timestamp column's box to the window's right
 * edge at `REVEAL_SETTLED`. `styles.revealColumn` in ChatScreen.js pads the box
 * by `TRANSCRIPT_MARGIN` minus this, so the text ends at the transcript margin.
 */
export const REVEAL_COLUMN_LANDING = 2;

/*
 * The reveal offset (points) at which the timestamp column's box is
 * `REVEAL_COLUMN_LANDING` from the window's right edge and the times are fully
 * opaque. ChatScreen.js scales the sent balloons' and the column's movement to
 * it, and ReactionCheck.swift copies it as `settled`. See ui-metrics.md,
 * "Timestamp reveal travel".
 */
export const REVEAL_SETTLED = REVEAL_COLUMN + REVEAL_COLUMN_LANDING;

/**
 * The reveal offset for a leftward drag of `pulled` points: 0 for no drag,
 * `REVEAL_LIMIT / 2` when `pulled` is `REVEAL_LIMIT`, and approaching
 * `REVEAL_LIMIT` for longer drags.
 */
export function resistedReveal(pulled) {
  if (!(pulled > 0)) {
    return 0;
  }
  return REVEAL_LIMIT * (1 - 1 / (1 + pulled / REVEAL_LIMIT));
}

/**
 * Gap in points between a balloon moved by `REVEAL_SETTLED` and a column
 * `REVEAL_COLUMN` wide ending `REVEAL_COLUMN_LANDING` from the window's right
 * edge; equals `transcriptMargin`. Only `__tests__/resistedReveal-test.js`
 * calls it. It ignores `SENT_REVEAL_GAP` and the column's padding in
 * ChatScreen.js, so it is not the gap on screen.
 */
export function revealGap(transcriptMargin, window = 402) {
  const balloonRight = window - transcriptMargin - REVEAL_SETTLED;
  const columnLeft = window - REVEAL_COLUMN_LANDING - REVEAL_COLUMN;
  return columnLeft - balloonRight;
}

/*
 * Timestamp opacity is `(offset / REVEAL_SETTLED) ^ REVEAL_INK_CURVE`, driven
 * by the drag rather than a timed transition. Fitted to native Messages;
 * ReactionCheck.swift copies it as `inkCurve`. See ui-metrics.md, "Timestamp
 * reveal ink curve".
 */
export const REVEAL_INK_CURVE = 2.2;

/**
 * Timestamp opacity (0 to 1) for a reveal offset of `shown` points.
 * ReactionCheck.swift copies it as `ink`.
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

/*
 * Number of straight segments `revealInkRamp` uses to approximate `revealInk`
 * for a native-driver `interpolate`, which can't take an easing function.
 * Eight keep the opacity error under 0.005.
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
