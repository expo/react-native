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
 * The rubber band the transcript's timestamp reveal is dragged against.
 *
 * Tested as ARITHMETIC because the gesture around it cannot be tested at all:
 * XCUITest's drag blocks until the finger lifts, and the reveal springs back
 * the moment it does — so a UI test reads the resting state whichever way it is
 * written, and two attempts at one did exactly that before this file existed.
 * Sampling from another queue is not a way out either; XCUITest refuses to
 * synthesise from anywhere but the main thread.
 *
 * It also lives in its own module for that reason: importing `ChatScreen` to
 * reach it loaded the whole element catalog and failed outside a renderer.
 *
 * What is left is the part that could actually be wrong: the curve. The
 * assertions below are its defining PROPERTIES rather than points off a
 * screenshot, because the three readings taken from the native chat — a 20-point
 * drag
 * moving the balloons 16, a 40-point drag 20, a 161-point drag 39 — were
 * captured mid-gesture with a finger that had not finished travelling, and
 * fitting a curve to them exactly would be fitting the capture's noise.
 *
 * The ONE reading worth pinning to is the far end, and it was taken differently:
 * a three-second drag the width of the screen, recorded, with a sent balloon's
 * trailing edge tracked frame by frame. It rests at 371 and stops at 315 — 56
 * points — and stops there before the finger has finished, so it is the whole
 * travel rather than a snapshot of one.
 */

import {
  REVEAL_COLUMN,
  REVEAL_COLUMN_LANDING,
  REVEAL_LIMIT,
  REVEAL_SETTLED,
  resistedReveal,
  revealGap,
} from '../reveal';

test('a finger that has not moved reveals nothing', () => {
  expect(resistedReveal(0)).toBe(0);
});

test('pulling the wrong way reveals nothing', () => {
  // The responder only claims leftward drags, but the arithmetic is what would
  // turn a rightward one into a negative offset if it were let through.
  expect(resistedReveal(-40)).toBe(0);
});

test('it never reaches the limit, however hard it is pulled', () => {
  // The property that stops the drag feeling like it has hit a wall: there is
  // always a little more travel left.
  for (const pulled of [10, 50, 200, 1000, 100000]) {
    expect(resistedReveal(pulled)).toBeLessThan(REVEAL_LIMIT);
  }
});

test('a limit’s worth of finger has moved half the limit', () => {
  // What sets how quickly the resistance is felt, and the one exact value the
  // curve is pinned to.
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
  // Together with "never reaches", this is what makes it a limit rather than a
  // cap the drag settles below.
  expect(resistedReveal(100000)).toBeGreaterThan(REVEAL_LIMIT - 0.1);
});

test('a drag the width of the screen lands where the native chat does', () => {
  // The one reading taken with a finger that had finished travelling: 360 points
  // of drag move the native chat's balloons 56, and it stops there.
  expect(resistedReveal(360)).toBeGreaterThan(54);
  expect(resistedReveal(360)).toBeLessThan(58);
});

test('a decisive drag can actually reach the settled state', () => {
  // It could not: the limit was 50 against a settled travel that is now 54, so
  // the column was aimed at a place the curve could never take the balloons.
  expect(REVEAL_LIMIT).toBeGreaterThan(REVEAL_SETTLED);
  expect(resistedReveal(400)).toBeGreaterThan(REVEAL_SETTLED);
});

/*
 * The column of times has to FIT in the space the drag opens, and it did not.
 *
 * This is arithmetic, which is why it belongs here rather than in a UI test: the
 * dragged state is not observable from XCUITest — `press(…thenHoldForDuration:)`
 * blocks until the finger lifts and the reveal springs back — so the collision
 * this catches was invisible to every automated check the project had and was
 * reported from a phone instead.
 */
describe('a sent balloon keeps its margin from its own time', () => {
  const TRANSCRIPT_MARGIN = 16;

  /*
   * The rule, and the reason the travel is not a fitted number: a sent balloon
   * rests `TRANSCRIPT_MARGIN` from the trailing edge, so moving it by exactly
   * what the column occupies leaves that same margin between the two. Measured
   * against the native chat, which leaves seventeen.
   */
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
   * Both failures this arithmetic has had, kept as cases so the rule cannot be
   * quietly replaced by a number that happens to pass. A 40-point travel left
   * the time crowding the balloon at the settled state and worse on a longer
   * drag, because the column then had to travel 1.4x the balloons and ate the
   * gap as it came in; measured at four points on the device screenshot that
   * reported it. And a column landing on the transcript's margin instead of
   * its own inset puts the time ON TOP of the balloon. The exact numbers moved
   * by two when the column widened from 52 to 54 (the times are right-aligned
   * to the transcript margin now, and the occupied 56 is the travel measured
   * off the native chat's own drag); the shapes of the two failures are what the
   * cases hold.
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
