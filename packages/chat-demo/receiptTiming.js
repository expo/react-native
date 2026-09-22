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
 * Timings for the read receipt's animations in `ChatScreen.js`: moving to a
 * newer message, appearing, and changing text. Imports no components, so
 * `__tests__/receiptTiming-test.js` can load it.
 */

import {
  CHAT_BUBBLE_TAIL_MORPH,
  CHAT_BUBBLE_TAIL_MORPH_CURVE,
} from '../expo-intrinsics/src/chatBubbleMetrics';

/** Re-exported for `__tests__/receiptTiming-test.js`. */
export const TAIL_MORPH_MS: number = CHAT_BUBBLE_TAIL_MORPH;

/**
 * Duration and easing of the layout changes when the receipt moves to a newer
 * message: the previous balloon losing its tail, and the receipt's space
 * closing on one row and opening on the next. They must stay the tail morph's
 * values from chatBubbleMetrics.js, or the transcript moves in two steps.
 */
export const RECEIPT_LAYOUT_MS: number = TAIL_MORPH_MS;
export const RECEIPT_LAYOUT_CURVE: string = CHAT_BUBBLE_TAIL_MORPH_CURVE;

/**
 * Fade-out of the old receipt's text. Must stay shorter than
 * `RECEIPT_LAYOUT_MS`, so the text is gone before its row finishes closing.
 * See ui-metrics.md, "Receipt handover".
 */
export const RECEIPT_LEAVE_MS: number = 100;

/**
 * Time with no receipt shown between the old receipt fading out and the new
 * one appearing. Native Messages doesn't cross-fade them. See ui-metrics.md,
 * "Receipt handover".
 */
export const RECEIPT_HANDOVER_GAP_MS: number = 250;

/**
 * Delay before the new receipt's text appears. A sum, because the renderer has
 * no `transitionend` event to chain the animations on.
 */
export const RECEIPT_INK_DELAY_MS: number =
  RECEIPT_LEAVE_MS + RECEIPT_HANDOVER_GAP_MS;

/**
 * The new receipt's text scales up about its centre over `RECEIPT_GROW_MS`
 * (from `RECEIPT_GROW_FROM` in ChatScreen.js) and fades in over the shorter
 * `RECEIPT_FADE_MS`. Neither changes layout, so neither is tied to
 * `RECEIPT_LAYOUT_MS`. See ui-metrics.md, "Receipt arrival".
 */
export const RECEIPT_GROW_MS: number = 610;
export const RECEIPT_FADE_MS: number = 133;

/**
 * Easing for the scale only, fitted with `RECEIPT_GROW_MS` (quartic ease-out).
 * The fade uses plain `ease-out`: its curve wasn't measured.
 */
export const RECEIPT_GROW_CURVE: string = 'cubic-bezier(0.25, 1, 0.5, 1)';
// The scale the receipt grows from. Fitted together with `RECEIPT_GROW_MS`
// and `RECEIPT_GROW_CURVE`; change the three together. See ui-metrics.md,
// "Receipt arrival".
export const RECEIPT_GROW_FROM: number = 0.21;

/*
 * The receipt text changing on the same message (`Delivered` to
 * `Read 5:29 PM`): fade out, a gap with no text, fade in. Opacity only;
 * unlike an arrival, nothing scales. See ui-metrics.md, "Receipt word swap".
 */
export const RECEIPT_SWAP_OUT_MS: number = 175;
export const RECEIPT_SWAP_GAP_MS: number = 100;
export const RECEIPT_SWAP_IN_MS: number = 217;

export const RECEIPT_SWAP_AT_MS: number =
  RECEIPT_SWAP_OUT_MS + RECEIPT_SWAP_GAP_MS;

/**
 * `RECEIPT_SETTLED_MS`: time from a receipt being shown to its text being
 * fully visible. `RECEIPT_HOLD_MS`: the minimum time the text then stays
 * before it can change (e.g. `Delivered` to `Read`); a pacing choice for the
 * demo, not a measurement. `ReceiptCheck.swift` asserts the resulting
 * interval, so move its band by the same amount if you change the hold.
 */
export const RECEIPT_SETTLED_MS: number =
  RECEIPT_INK_DELAY_MS + RECEIPT_FADE_MS;
export const RECEIPT_HOLD_MS: number = 1600;
