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
 * The reaction cycle the "React to the last message" command steps through.
 *
 * There is no picker — the native floating pill needs a private accessory view a
 * `<menu>` cannot make — so the command walks the six reactions on repeated taps.
 * Two edges are the whole behaviour and both are easy to get wrong: the
 * COLD START (no reaction yet) must land on Heart, and the LAST must WRAP back
 * to Heart rather than running off the end of the array. Pure arithmetic, so it
 * is tested here rather than through the ten-minute UI suite (`FlowDrive` only
 * proves the first tap paints a badge; it cannot tap six times and read each).
 */

import {REACTIONS, cycleReaction} from '../reactions';

test('a message with no reaction yet lands on Heart', () => {
  // `undefined` is the cold start; `findIndex` misses at -1 and -1 + 1 is 0.
  expect(cycleReaction(undefined)).toBe('heart');
});

test('an id no longer in the set also falls back to Heart', () => {
  // A persisted reaction whose reaction was removed from `REACTIONS` must not
  // wedge the cycle — it is a miss like any other, so the next tap is Heart.
  expect(cycleReaction('this-reaction-was-deleted')).toBe('heart');
});

test('each reaction steps to the next in the native order', () => {
  const order = REACTIONS.map(entry => entry.id);
  for (let i = 0; i < order.length - 1; i++) {
    expect(cycleReaction(order[i])).toBe(order[i + 1]);
  }
});

test('the last reaction wraps back to the first', () => {
  const last = REACTIONS[REACTIONS.length - 1].id;
  expect(cycleReaction(last)).toBe(REACTIONS[0].id);
});

test('six taps from cold return to the start — a full cycle', () => {
  let current;
  const seen = [];
  for (let i = 0; i < REACTIONS.length; i++) {
    current = cycleReaction(current);
    seen.push(current);
  }
  // Every reaction appears exactly once, in order, and the next tap repeats.
  expect(seen).toEqual(REACTIONS.map(entry => entry.id));
  expect(cycleReaction(current)).toBe(REACTIONS[0].id);
});

test('every reaction carries the four fields the badge and VoiceOver need', () => {
  for (const entry of REACTIONS) {
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.glyph).toBe('string');
    expect(typeof entry.label).toBe('string');
    expect(typeof entry.symbol).toBe('string');
  }
});
