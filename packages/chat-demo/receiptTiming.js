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
 * When a receipt moves from one message to the next, and what moves with it.
 *
 * Its own module, and a leaf one, for two reasons. The numbers are shared by
 * things that are not near each other — a balloon's tail in the elements
 * package, a receipt's box in the transcript — and one of them is an INVARIANT
 * rather than a taste: everything that moves the column has to move at the same
 * speed or the column moves twice. Nothing here pulls in a component, so a plain
 * unit test can import it and say so. See `__tests__/receiptTiming-test.js`.
 */

import {
  CHAT_BUBBLE_TAIL_MORPH,
  CHAT_BUBBLE_TAIL_MORPH_CURVE,
} from '../expo-intrinsics/src/chatBubbleMetrics';

/**
 * The tail's own clock, which the element owns — re-exported so the test below
 * can compare the two without importing a component.
 */
export const TAIL_MORPH_MS: number = CHAT_BUBBLE_TAIL_MORPH;

/**
 * How long anything that moves the transcript's layout takes.
 *
 * A handover moves the column twice over: the balloon that loses its tail gives
 * back the space reserved for it, and the receipt's own box closes on one row
 * while it opens on the next. Separate transitions on separate elements, and
 * they compose into ONE movement only while they share this — so it is the
 * tail's number, taken rather than repeated.
 */
export const RECEIPT_LAYOUT_MS: number = TAIL_MORPH_MS;

/**
 * On the tail's curve too, and for the same reason — two boxes moving together
 * over the same 250ms still move twice if one of them eases and the other does
 * not.
 */
export const RECEIPT_LAYOUT_CURVE: string = CHAT_BUBBLE_TAIL_MORPH_CURVE;

/*
 * NOTE: `RECEIPT_LAYOUT_MS` is what moves the COLUMN, and it stays tied to the
 * tail. `RECEIPT_LEAVE_MS` below is what the old receipt's ink does, which
 * moves nothing and so is free to differ — and does.
 */

/**
 * How long the OLD receipt's ink takes to go.
 *
 * Measured off the native chat, ink counted per frame in the row the old
 * `Read 4:13 PM`
 * occupies: 154 at t=2530, 121 at 2580, nothing at 2630. A hundred
 * milliseconds.
 *
 * SHORTER than the layout, deliberately, and this is the one number here that
 * is not tied to the others. The words are gone well before the row that held
 * them has finished closing, so there is never ink sitting over a box that is
 * still moving — which is the state the reports kept catching, in two different
 * disguises: clipped when the box closed under it, and then floating when the
 * box waited for it.
 */
export const RECEIPT_LEAVE_MS: number = 100;

/**
 * And how long the transcript then waits before the new one arrives.
 *
 * The native chat leaves a GAP. The old receipt is gone at t=2630 and the new
 * one does
 * not appear until t=2880 — a quarter of a second with no receipt on screen at
 * all, deliberately.
 *
 * This corrects a reading of the same recording that said the two CROSS-FADE.
 * They do not: what looked like both at once was the old one fading in the row
 * it had always been in while the column moved under it. Reported from a device
 * as "the new read indicator does not wait for the old one to fully disappear
 * before appearing", which is exactly right.
 */
export const RECEIPT_HANDOVER_GAP_MS: number = 250;

/**
 * So the ink waits for both: the old one to finish leaving, and the pause after
 * it. The renderer has no `transitionend`, so "after" can only be said as a
 * delay — which is why this is a sum of the two numbers above rather than one
 * chosen on its own.
 */
export const RECEIPT_INK_DELAY_MS: number =
  RECEIPT_LEAVE_MS + RECEIPT_HANDOVER_GAP_MS;

/**
 * The ink's own two durations, which move nothing and so need not agree with
 * anything. Measured off the native chat: it grows from 0.61 over 435ms and keeps
 * fading for a while after it has stopped growing.
 */
export const RECEIPT_GROW_MS: number = 435;
export const RECEIPT_FADE_MS: number = 600;
