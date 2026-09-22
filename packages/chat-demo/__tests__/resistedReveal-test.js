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

import {
  REVEAL_COLUMN,
  REVEAL_COLUMN_LANDING,
  REVEAL_LIMIT,
  REVEAL_SETTLED,
  TRANSCRIPT_MARGIN,
  resistedReveal,
  revealGap,
  revealInk,
  revealInkRamp,
} from '../reveal';

test('a finger that has not moved reveals nothing', () => {
  expect(resistedReveal(0)).toBe(0);
});

test('pulling the wrong way reveals nothing', () => {
  expect(resistedReveal(-40)).toBe(0);
});

test('it never reaches the limit, however hard it is pulled', () => {
  for (const pulled of [10, 50, 200, 1000, 100000]) {
    expect(resistedReveal(pulled)).toBeLessThan(REVEAL_LIMIT);
  }
});

test('a limit’s worth of finger has moved half the limit', () => {
  expect(resistedReveal(REVEAL_LIMIT)).toBeCloseTo(REVEAL_LIMIT / 2, 6);
});

test('it always moves further for a longer pull', () => {
  let previous = 0;
  for (let pulled = 1; pulled <= 400; pulled += 7) {
    const now = resistedReveal(pulled);
    expect(now).toBeGreaterThan(previous);
    previous = now;
  }
});

test('it approaches the limit rather than stopping short of it', () => {
  expect(resistedReveal(100000)).toBeGreaterThan(REVEAL_LIMIT - 0.1);
});

test('a drag the width of the screen lands where the native chat does', () => {
  // Native Messages moves the balloons 56 pt for a 360 pt drag.
  // See ui-metrics.md, "Timestamp reveal travel".
  expect(resistedReveal(360)).toBeGreaterThan(54);
  expect(resistedReveal(360)).toBeLessThan(58);
});

test('a decisive drag can actually reach the settled state', () => {
  // The timestamp column is in place, and fully opaque, only once the balloons
  // have moved `REVEAL_SETTLED`.
  expect(REVEAL_LIMIT).toBeGreaterThan(REVEAL_SETTLED);
  expect(resistedReveal(400)).toBeGreaterThan(REVEAL_SETTLED);
});

describe('a sent balloon keeps its margin from its own time', () => {
  test('the gap is the transcript margin', () => {
    expect(revealGap(TRANSCRIPT_MARGIN)).toBe(TRANSCRIPT_MARGIN);
  });

  test('which is the travel being the column and its landing', () => {
    expect(REVEAL_SETTLED).toBe(REVEAL_COLUMN + REVEAL_COLUMN_LANDING);
  });

  test('and the column lands inside the window rather than off the edge', () => {
    expect(REVEAL_COLUMN_LANDING).toBeGreaterThanOrEqual(0);
  });

  /*
   * Two wrong layouts, computed with the current column size: a 40 pt travel
   * instead of `REVEAL_SETTLED`, and the column placed at `TRANSCRIPT_MARGIN`
   * instead of `REVEAL_COLUMN_LANDING`.
   */
  test('a forty-point travel leaves no gap at all', () => {
    const window = 402;
    const balloonRight = window - TRANSCRIPT_MARGIN - 40;
    const columnLeft = window - REVEAL_COLUMN_LANDING - REVEAL_COLUMN;
    expect(columnLeft - balloonRight).toBeLessThanOrEqual(2);
  });

  test('and landing on the transcript margin collides, which was the first bug', () => {
    const window = 402;
    const balloonRight = window - TRANSCRIPT_MARGIN - 40;
    const columnLeft = window - TRANSCRIPT_MARGIN - REVEAL_COLUMN;
    expect(balloonRight - columnLeft).toBeGreaterThanOrEqual(12);
  });
});

/**
 * Points from a 60 fps capture of native Messages. The 0.036 tolerance is twice
 * the rms error of the `REVEAL_INK_CURVE` fit.
 * See ui-metrics.md, "Timestamp reveal ink curve".
 */
describe('the revealed times are inked by the drag', () => {
  // [travel as a fraction of the settled travel, opacity]. The capture settled
  // at 58 pt; fractions scale it to `REVEAL_SETTLED`.
  const CAPTURE = [
    [26.0 / 58, 0.2],
    [35.33 / 58, 0.34],
    [42.33 / 58, 0.5],
    [48.67 / 58, 0.67],
    [53.33 / 58, 0.81],
    [58.0 / 58, 0.99],
  ];

  test.each(CAPTURE)('at %f of the travel the ink is %f', (p, alpha) => {
    expect(revealInk(p * REVEAL_SETTLED)).toBeCloseTo(alpha, 1);
    expect(Math.abs(revealInk(p * REVEAL_SETTLED) - alpha)).toBeLessThan(0.036);
  });

  test('nothing at rest', () => {
    expect(revealInk(0)).toBe(0);
    expect(revealInk(-10)).toBe(0);
  });

  test('and full strength at the settled state, not past it', () => {
    expect(revealInk(REVEAL_SETTLED)).toBe(1);
    expect(revealInk(REVEAL_LIMIT)).toBe(1);
  });

  test('never darker for a shorter drag', () => {
    let last = -1;
    for (let shown = 0; shown <= REVEAL_SETTLED; shown += 0.5) {
      const ink = revealInk(shown);
      expect(ink).toBeGreaterThanOrEqual(last);
      last = ink;
    }
  });

  /*
   * Animated's native driver interpolates linearly between `inputRange` stops,
   * so it runs this ramp, not `revealInk`. The ramp's error must stay well
   * under the fit's 0.018 rms.
   */
  test('the native ramp is the curve, to a quarter of the fit', () => {
    const {inputRange, outputRange, extrapolate} = revealInkRamp();
    expect(extrapolate).toBe('clamp');
    expect(inputRange[0]).toBe(0);
    expect(inputRange[inputRange.length - 1]).toBe(REVEAL_SETTLED);
    let worst = 0;
    for (let shown = 0; shown <= REVEAL_SETTLED; shown += 0.1) {
      let stop = 0;
      while (stop < inputRange.length - 2 && inputRange[stop + 1] < shown) {
        stop++;
      }
      const span = inputRange[stop + 1] - inputRange[stop];
      const along = (shown - inputRange[stop]) / span;
      const ramped =
        outputRange[stop] + along * (outputRange[stop + 1] - outputRange[stop]);
      worst = Math.max(worst, Math.abs(ramped - revealInk(shown)));
    }
    expect(worst).toBeLessThan(0.006);
  });
});
