/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

import {
  RECEIPT_HANDOVER_GAP_MS,
  RECEIPT_INK_DELAY_MS,
  RECEIPT_LAYOUT_MS,
  RECEIPT_LEAVE_MS,
  TAIL_MORPH_MS,
} from '../receiptTiming';

/*
 * ONE duration for everything that moves the transcript, checked rather than
 * remembered.
 *
 * A receipt handing over from one message to the next moves the column twice:
 * the balloon losing its tail gives back the 6.65 points reserved for it, and
 * the receipt's space closes on one row while it opens on the next. Those are
 * separate transitions on separate elements, and they compose into a single
 * smooth movement only while they share a duration. Give them two and the
 * column moves twice at two speeds, which was reported from a device as "the
 * bubbles jitter as the read indicators and bubbles transition".
 *
 * Everything else in that animation is derived rather than timed — the tail's
 * outline is computed from the reserve the box currently has, and the side it
 * hangs on is held in state — so this is the only place where the result
 * depends on two numbers agreeing. The renderer has no `transitionend`, so they
 * cannot be sequenced on completion; the next best thing is that there is one
 * number, and that a test says so.
 */
test('everything that moves the transcript shares one duration', () => {
  expect(RECEIPT_LAYOUT_MS).toBe(TAIL_MORPH_MS);
});

/*
 * And the ink is gone before its row is.
 *
 * Not an invariant of the renderer — the ink moves nothing, so the two COULD be
 * anything — but the ordering the reports kept landing on. Ink still visible
 * while the box under it is moving reads as broken in whichever direction it is
 * got wrong: the box closing first clips the words into a wipe, the box waiting
 * leaves them floating over a gap. Strictly shorter is the only arrangement
 * neither report can be made about.
 */
test('the old receipt is gone before its row has finished closing', () => {
  expect(RECEIPT_LEAVE_MS).toBeLessThan(RECEIPT_LAYOUT_MS);
});

/*
 * And the new one waits for the old one to be GONE, plus the pause after it.
 *
 * The native chat does not cross-fade the two: the old receipt has finished at
 * t=2630 and the new one does not appear until t=2880. The renderer has no
 * `transitionend`, so the only way to say "after both of those" is a delay that
 * is their sum — which makes this the assertion that the delay was derived from
 * the two measurements and not picked to look right.
 */
test('the new receipt waits out the old one and the gap after it', () => {
  expect(RECEIPT_INK_DELAY_MS).toBe(RECEIPT_LEAVE_MS + RECEIPT_HANDOVER_GAP_MS);
  expect(RECEIPT_HANDOVER_GAP_MS).toBeGreaterThan(0);
});
