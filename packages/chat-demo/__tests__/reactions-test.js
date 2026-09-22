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

import {REACTIONS, cycleReaction} from '../reactions';

test('a message with no reaction yet lands on Heart', () => {
  expect(cycleReaction(undefined)).toBe('heart');
});

test('an id no longer in the set also falls back to Heart', () => {
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
